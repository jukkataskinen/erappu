import type { Sql } from "@/lib/db";
import { buildAnnualCycle } from "./annual-cycle";
import type { IsoDate } from "./dates";
import type { TaskCategory } from "./labels";
import { nextOccurrence, normalizeRecurrence, parseRecurrence, type Recurrence } from "./recurrence";

/**
 * Vuosikellon kyselyt ja muutokset. Ajetaan käyttäjän RLS-transaktiossa;
 * muistutusajo (reminders.ts) käyttää palvelun roolia.
 */

export interface TaskRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  company_name: string | null;
  title: string;
  description: string | null;
  due_on: IsoDate;
  recurrence: Recurrence | null;
  category: TaskCategory;
  assignee_user_id: string | null;
  assignee_name: string | null;
  done_at: string | null;
  done_by_name: string | null;
  series_id: string | null;
  template_key: string | null;
}

const TASK_COLUMNS = `t.id, t.organization_id, t.company_id, c.name as company_name, t.title, t.description,
  to_char(t.due_on, 'YYYY-MM-DD') as due_on, t.recurrence, t.category, t.assignee_user_id,
  coalesce(a.full_name, a.email) as assignee_name, t.done_at, coalesce(d.full_name, d.email) as done_by_name,
  t.series_id, t.template_key`;

const TASK_FROM = `from er_tasks t
  left join er_housing_companies c on c.id = t.company_id
  left join er_users a on a.id = t.assignee_user_id
  left join er_users d on d.id = t.done_by`;

function mapTask(r: TaskRow): TaskRow {
  return { ...r, recurrence: parseRecurrence(r.recurrence) };
}

export interface TaskFilter {
  organizationId: string;
  companyId?: string | null;
  category?: TaskCategory | null;
  assigneeUserId?: string | null;
  /** Vain myöhässä olevat (eräpäivä ennen tätä päivää, kuittaamatta). */
  overdueOnly?: boolean;
  today: IsoDate;
  /** Avoimet tehtävät tähän päivään asti (myöhässä olevat aina mukana). */
  until?: IsoDate;
  includeDone?: boolean;
  limit?: number;
}

export async function listTasks(tx: Sql, f: TaskFilter): Promise<TaskRow[]> {
  const where: string[] = ["t.organization_id = $1"];
  const params: unknown[] = [f.organizationId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.companyId) add("t.company_id = ?", f.companyId);
  if (f.category) add("t.category = ?", f.category);
  if (f.assigneeUserId) add("t.assignee_user_id = ?", f.assigneeUserId);
  if (f.overdueOnly) {
    add("t.due_on < ?::date", f.today);
    where.push("t.done_at is null");
  } else if (!f.includeDone) {
    where.push("t.done_at is null");
  }
  if (f.until) add("t.due_on <= ?::date", f.until);
  params.push(f.limit ?? 500);
  const rows = await tx.query<TaskRow>(
    `select ${TASK_COLUMNS} ${TASK_FROM} where ${where.join(" and ")} order by t.due_on, c.name nulls first, t.title limit $${params.length}`,
    params,
  );
  return rows.map(mapTask);
}

export async function getTask(tx: Sql, id: string): Promise<TaskRow | null> {
  const [row] = await tx.query<TaskRow>(`select ${TASK_COLUMNS} ${TASK_FROM} where t.id = $1`, [id]);
  return row ? mapTask(row) : null;
}

export async function listRecentlyDone(tx: Sql, organizationId: string, limit = 20): Promise<TaskRow[]> {
  const rows = await tx.query<TaskRow>(
    `select ${TASK_COLUMNS} ${TASK_FROM} where t.organization_id = $1 and t.done_at is not null order by t.done_at desc limit $2`,
    [organizationId, limit],
  );
  return rows.map(mapTask);
}

export interface NewTask {
  organizationId: string;
  companyId: string | null;
  title: string;
  description: string | null;
  dueOn: IsoDate;
  recurrence: Recurrence | null;
  category: TaskCategory;
  assigneeUserId: string | null;
  createdBy: string | null;
  templateKey?: string | null;
}

export async function insertTask(tx: Sql, t: NewTask): Promise<string> {
  const rule = t.recurrence ? normalizeRecurrence(t.recurrence, t.dueOn) : null;
  const [row] = await tx.query<{ id: string }>(
    `insert into er_tasks (organization_id, company_id, title, description, due_on, recurrence, category, assignee_user_id, created_by, template_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [t.organizationId, t.companyId, t.title, t.description, t.dueOn, rule ? JSON.stringify(rule) : null, t.category, t.assigneeUserId, t.createdBy, t.templateKey ?? null],
  );
  return row.id;
}

/**
 * Kuittaa tehtävän. Toistuvasta tehtävästä luodaan seuraava esiintymä
 * samaan sarjaan; uniikki indeksi (series_id, due_on) estää tuplat, jos
 * kuittaus tulee kahdesti.
 */
export async function completeTask(tx: Sql, input: { taskId: string; userId: string }): Promise<{ completed: boolean; organizationId?: string; nextId?: string; nextDue?: IsoDate }> {
  const [done] = await tx.query<{
    organization_id: string; company_id: string | null; title: string; description: string | null; due_on: IsoDate;
    recurrence: unknown; category: TaskCategory; assignee_user_id: string | null; series_id: string | null; template_key: string | null; id: string;
  }>(
    `update er_tasks set done_at = now(), done_by = $2
      where id = $1 and done_at is null
      returning id, organization_id, company_id, title, description, to_char(due_on, 'YYYY-MM-DD') as due_on, recurrence, category,
                assignee_user_id, series_id, template_key`,
    [input.taskId, input.userId],
  );
  if (!done) return { completed: false };
  const rule = parseRecurrence(done.recurrence);
  if (!rule) return { completed: true, organizationId: done.organization_id };

  const nextDue = nextOccurrence(done.due_on, rule);
  const [next] = await tx.query<{ id: string }>(
    `insert into er_tasks (organization_id, company_id, title, description, due_on, recurrence, category, assignee_user_id, series_id, template_key, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (series_id, due_on) where series_id is not null do nothing
     returning id`,
    [done.organization_id, done.company_id, done.title, done.description, nextDue, JSON.stringify(rule), done.category, done.assignee_user_id,
      done.series_id ?? done.id, done.template_key, input.userId],
  );
  return { completed: true, organizationId: done.organization_id, nextId: next?.id, nextDue };
}

/**
 * Luo yhtiölle vakiovuosikellon. Pohjaa ei luoda, jos yhtiöllä on jo avoin
 * tehtävä samalla pohjalla, joten toiminnon voi ajaa uudelleen turvallisesti.
 */
export async function createAnnualCycleForCompany(
  tx: Sql,
  input: { companyId: string; userId: string; today: IsoDate; assigneeUserId?: string | null },
): Promise<{ organizationId: string; created: number; skipped: number } | null> {
  const [company] = await tx.query<{ organization_id: string; fiscal_year_start: string; manager_user_id: string | null; cert_year: number | null }>(
    `select c.organization_id, c.fiscal_year_start,
            (select m.user_id from er_org_members m where m.organization_id = c.organization_id and m.user_id = c.manager_user_id) as manager_user_id,
            (select min(b.energy_certificate_year)::int from er_buildings b where b.company_id = c.id) as cert_year
       from er_housing_companies c where c.id = $1`,
    [input.companyId],
  );
  if (!company) return null;

  const existing = new Set(
    (await tx.query<{ template_key: string }>(
      "select template_key from er_tasks where company_id = $1 and template_key is not null and done_at is null",
      [input.companyId],
    )).map((r) => r.template_key),
  );
  const templates = buildAnnualCycle({ fiscalYearStart: company.fiscal_year_start, today: input.today, energyCertificateYear: company.cert_year });
  let created = 0;
  for (const t of templates) {
    if (existing.has(t.key)) continue;
    await tx.query(
      `insert into er_tasks (organization_id, company_id, title, description, due_on, recurrence, category, assignee_user_id, created_by, template_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [company.organization_id, input.companyId, t.title, t.description, t.due_on, t.recurrence ? JSON.stringify(t.recurrence) : null, t.category,
        input.assigneeUserId ?? company.manager_user_id, input.userId, t.key],
    );
    created++;
  }
  return { organizationId: company.organization_id, created, skipped: templates.length - created };
}
