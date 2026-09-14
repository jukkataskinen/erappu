import type { Sql } from "@/lib/db";
import { queueMessage } from "@/lib/messaging";
import { addDays, shortFinnishDate, type IsoDate } from "./dates";

/**
 * Vuosikellon muistutukset vastuuhenkilöille. Ajetaan palvelun roolilla
 * ajastetusta reitistä (/api/cron/muistutukset).
 *
 * Idempotentti: tehtävään kirjataan last_reminded_on samassa transaktiossa
 * kuin viesti jonoon. Tänään erääntyvä muistutetaan kerran, myöhässä oleva
 * enintään kerran viikossa, jotta jono ei täyty samoista viesteistä.
 * Vastuuhenkilön puuttuessa muistutus menee yhtiön isännöitsijälle.
 */

export const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

interface DueTask {
  id: string;
  organization_id: string;
  title: string;
  due_on: IsoDate;
  company_name: string | null;
  recipient: string;
}

export async function queueTaskReminders(tx: Sql, today: IsoDate, appBaseUrl = process.env.APP_BASE_URL ?? ""): Promise<{ messages: number; tasks: number }> {
  const rows = await tx.query<DueTask>(
    `select t.id, t.organization_id, t.title, to_char(t.due_on, 'YYYY-MM-DD') as due_on, c.name as company_name, u.email as recipient
       from er_tasks t
       left join er_housing_companies c on c.id = t.company_id
       join er_users u on u.id = coalesce(t.assignee_user_id, c.manager_user_id)
       join er_org_members m on m.organization_id = t.organization_id and m.user_id = u.id
      where t.done_at is null
        and t.due_on <= $1::date
        and (t.last_reminded_on is null or t.last_reminded_on <= $2::date)
      order by t.organization_id, u.email, t.due_on
      for update of t skip locked`,
    [today, addDays(today, -OVERDUE_REMINDER_INTERVAL_DAYS)],
  );
  if (rows.length === 0) return { messages: 0, tasks: 0 };

  const groups = new Map<string, DueTask[]>();
  for (const r of rows) {
    const key = `${r.organization_id}|${r.recipient}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  for (const tasks of groups.values()) {
    const dueToday = tasks.filter((t) => t.due_on === today);
    const overdue = tasks.filter((t) => t.due_on < today);
    const line = (t: DueTask) => `- ${shortFinnishDate(t.due_on, true)} ${t.title}${t.company_name ? ` (${t.company_name})` : ""}`;
    const body = [
      "Hei,",
      "",
      dueToday.length ? `Tänään erääntyy:\n${dueToday.map(line).join("\n")}` : null,
      overdue.length ? `Myöhässä:\n${overdue.map(line).join("\n")}` : null,
      "",
      `Kuittaa tehdyt vuosikellossa: ${appBaseUrl}/vuosikello`,
    ].filter((x) => x !== null).join("\n");
    await queueMessage(tx, {
      organizationId: tasks[0].organization_id,
      recipient: tasks[0].recipient,
      subject: overdue.length ? `Vuosikello: ${tasks.length} tehtävää odottaa, ${overdue.length} myöhässä` : `Vuosikello: ${tasks.length} tehtävää erääntyy tänään`,
      body,
      subjectTable: "er_tasks",
      subjectId: tasks[0].id,
    });
  }

  await tx.query("update er_tasks set last_reminded_on = $2::date where id = any($1::uuid[])", [rows.map((r) => r.id), today]);
  return { messages: groups.size, tasks: rows.length };
}
