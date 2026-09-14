import type { Sql } from "@/lib/db";
import { queueMessage } from "@/lib/messaging";
import { shortFinnishDate, type IsoDate } from "@/lib/tasks/dates";
import { noticeDeadline } from "./deadlines";
import { CONTRACT_CATEGORY_LABEL, type ContractCategory } from "./labels";

/**
 * Sopimusten irtisanomismuistutukset. Palvelun roolilla ajastetusta reitistä.
 * reminded_at kirjataan samassa transaktiossa kuin viesti, joten sama
 * muistutus ei lähde kahdesti. Kun reminder_on muuttuu, sovellus nollaa
 * reminded_at:n.
 *
 * Vastaanottaja: yhtiön isännöitsijä, tai jos sitä ei ole, organisaation
 * pääkäyttäjät ja isännöitsijät.
 */
export async function queueContractReminders(tx: Sql, today: IsoDate, appBaseUrl = process.env.APP_BASE_URL ?? ""): Promise<{ messages: number; contracts: number }> {
  const contracts = await tx.query<{
    id: string; organization_id: string; company_id: string; company_name: string; manager_user_id: string | null;
    counterparty: string; category: ContractCategory; ends_on: IsoDate | null; notice_months: number | null;
  }>(
    `select k.id, k.organization_id, k.company_id, c.name as company_name, c.manager_user_id, k.counterparty, k.category,
            to_char(k.ends_on, 'YYYY-MM-DD') as ends_on, k.notice_months
       from er_contracts k join er_housing_companies c on c.id = k.company_id
      where k.reminded_at is null and k.status <> 'ended' and k.reminder_on is not null and k.reminder_on <= $1::date
      order by k.reminder_on
      for update of k skip locked`,
    [today],
  );

  let messages = 0;
  for (const k of contracts) {
    const recipients = await tx.query<{ email: string }>(
      `select distinct u.email from er_org_members m join er_users u on u.id = m.user_id
        where m.organization_id = $1
          and (m.user_id = $2::uuid
               or (not exists (select 1 from er_org_members x where x.organization_id = $1 and x.user_id = $2::uuid)
                   and m.role in ('owner', 'manager')))`,
      [k.organization_id, k.manager_user_id],
    );
    const deadline = noticeDeadline(k.ends_on, k.notice_months);
    const body = [
      "Hei,",
      "",
      `${k.company_name}: ${k.counterparty} (${CONTRACT_CATEGORY_LABEL[k.category].toLowerCase()}).`,
      k.ends_on ? `Sopimus päättyy ${shortFinnishDate(k.ends_on, true)}.` : null,
      deadline ? `Irtisanomisen viimeinen päivä on ${shortFinnishDate(deadline, true)}.` : null,
      "",
      "Tarkista, jatketaanko sopimusta, kilpailutetaanko se vai irtisanotaanko.",
      `${appBaseUrl}/sopimukset/${k.id}`,
    ].filter((x) => x !== null).join("\n");
    for (const r of recipients) {
      await queueMessage(tx, {
        organizationId: k.organization_id,
        recipient: r.email,
        subject: `Sopimusmuistutus: ${k.company_name}, ${k.counterparty}`,
        body,
        subjectTable: "er_contracts",
        subjectId: k.id,
      });
      messages++;
    }
    await tx.query("update er_contracts set reminded_at = now() where id = $1", [k.id]);
  }
  return { messages, contracts: contracts.length };
}
