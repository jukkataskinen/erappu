import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { queueMessage } from "@/lib/messaging";
import { RENOVATION_STATUS_LABEL, validateRenovationUpdate, type RenovationStatus, type RenovationUpdate } from "./renovation";
import { isKnownWorkType } from "./work-types";
import type { NeedStatus } from "./labels";

/**
 * Korjaushistorian ja muutostyöilmoitusten kirjoitukset. Kutsutaan
 * käyttäjän RLS-transaktiossa.
 */

export class MaintenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceError";
  }
}

export interface NewNotice {
  userId: string;
  shareGroupId: string;
  description: string;
  workType: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
}

/**
 * Osakkaan muutostyöilmoitus. RLS sallii lisäyksen vain osakkaalle omaan
 * huoneistoon (0004), ja viesti vastuuisännöitsijälle lisätään samassa
 * transaktiossa (0021).
 */
export async function submitNotice(tx: Sql, n: NewNotice): Promise<string> {
  const [group] = await tx.query<{ organization_id: string; company_id: string }>(
    "select organization_id, company_id from er_share_groups where id = $1 and removed_on is null",
    [n.shareGroupId],
  );
  if (!group) throw new MaintenanceError("Huoneistoa ei löytynyt.");
  const [party] = await tx.query<{ id: string }>(
    "select id from er_parties where user_id = $1 and organization_id = $2 order by created_at limit 1",
    [n.userId, group.organization_id],
  );
  const [row] = await tx.query<{ id: string }>(
    `insert into er_renovation_notices (organization_id, company_id, share_group_id, submitted_by_user_id, submitted_by_party_id, description, work_type, planned_start, planned_end)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [group.organization_id, group.company_id, n.shareGroupId, n.userId, party?.id ?? null, n.description, n.workType, n.plannedStart, n.plannedEnd],
  );
  await tx.query("select er_notify_renovation_notice($1)", [row.id]);
  await audit(tx, { organizationId: group.organization_id, userId: n.userId, action: "create", entity: "renovation_notice", entityId: row.id });
  return row.id;
}

/**
 * Isännöitsijän käsittely. Valmistuessa työ kirjataan kunnossapito- ja
 * muutostyöhistoriaan osakkaan tekemänä, ja ilmoittaja saa viestin
 * tilamuutoksesta, jos hänen sähköpostiosoitteensa on rekisterissä.
 */
export async function processNotice(tx: Sql, opts: { id: string; userId: string; update: RenovationUpdate; today: string }): Promise<void> {
  const [cur] = await tx.query<{
    id: string; organization_id: string; company_id: string; share_group_id: string; status: RenovationStatus; description: string; work_type: string | null;
    maintenance_work_id: string | null; submitted_by_party_id: string | null; company_name: string; unit_label: string; decided_on: string | null;
  }>(
    `select n.id, n.organization_id, n.company_id, n.share_group_id, n.status, n.description, n.work_type, n.maintenance_work_id, n.submitted_by_party_id, n.decided_on::text,
            c.name as company_name, g.unit_label
       from er_renovation_notices n join er_housing_companies c on c.id = n.company_id join er_share_groups g on g.id = n.share_group_id
      where n.id = $1`,
    [opts.id],
  );
  if (!cur) throw new MaintenanceError("Ilmoitusta ei löytynyt.");
  // Aiempi päätöspäivä säilyy, jos lomake ei tuo uutta.
  const checked = validateRenovationUpdate(cur.status, { ...opts.update, decidedOn: opts.update.decidedOn ?? cur.decided_on }, opts.today);
  if ("error" in checked) throw new MaintenanceError(checked.error);
  const u = checked.value;

  let workId = cur.maintenance_work_id;
  if (u.status === "completed" && !workId) {
    const workType = isKnownWorkType(cur.work_type) ? cur.work_type! : "Muu";
    const [w] = await tx.query<{ id: string }>(
      `insert into er_maintenance_works (organization_id, company_id, share_group_id, project, work_type, completed_year, completed_on, description, performed_by, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'shareholder','renovation_notice') returning id`,
      [cur.organization_id, cur.company_id, cur.share_group_id, `Osakkaan muutostyö, ${cur.unit_label}`, workType, Number(u.completedOn!.slice(0, 4)), u.completedOn,
        cur.description.slice(0, 2000)],
    );
    workId = w.id;
  }

  const rows = await tx.query(
    `update er_renovation_notices set status = $2, conditions = $3, supervisor = $4, decided_on = $5, completed_on = $6, maintenance_work_id = $7
      where id = $1 returning id`,
    [cur.id, u.status, u.conditions, u.supervisor, u.decidedOn, u.completedOn, workId],
  );
  if (rows.length === 0) throw new MaintenanceError("Roolillasi ei voi käsitellä ilmoitusta.");

  if (u.status !== cur.status && cur.submitted_by_party_id) {
    const [p] = await tx.query<{ email: string | null }>("select email from er_parties where id = $1", [cur.submitted_by_party_id]);
    if (p?.email) {
      const extra = u.status === "approved_with_conditions" && u.conditions ? `\n\nEhdot:\n${u.conditions}` : "";
      await queueMessage(tx, {
        organizationId: cur.organization_id,
        recipient: p.email,
        partyId: cur.submitted_by_party_id,
        subject: `Muutostyöilmoitus: ${RENOVATION_STATUS_LABEL[u.status].toLowerCase()} (${cur.company_name}, ${cur.unit_label})`,
        body: `Muutostyöilmoituksesi tila on nyt: ${RENOVATION_STATUS_LABEL[u.status]}.${extra}\n\nNäet ilmoituksen tiedot portaalissa kohdassa Muutostyöt.`,
        subjectTable: "er_renovation_notices",
        subjectId: cur.id,
      });
    }
  }
  await audit(tx, { organizationId: cur.organization_id, userId: opts.userId, action: "update", entity: "renovation_notice", entityId: cur.id, details: { from: cur.status, to: u.status } });
}

export interface WorkInput {
  project: string;
  workType: string;
  completedYear: number | null;
  completedOn: string | null;
  costEur: number | null;
  description: string | null;
  performedBy: "company" | "shareholder";
  shareGroupId: string | null;
}

export async function saveWork(tx: Sql, opts: { companyId: string; id: string | null; userId: string; input: WorkInput }): Promise<string> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [opts.companyId]);
  if (!company) throw new MaintenanceError("Yhtiötä ei löytynyt.");
  const i = opts.input;
  if (i.shareGroupId) {
    const [g] = await tx.query("select 1 from er_share_groups where id = $1 and company_id = $2", [i.shareGroupId, opts.companyId]);
    if (!g) throw new MaintenanceError("Huoneistoa ei löytynyt.");
  }
  const year = i.completedYear ?? (i.completedOn ? Number(i.completedOn.slice(0, 4)) : null);
  let id = opts.id;
  if (id) {
    // Ilmoitettu rivi muuttuu: merkintä poistetaan, jotta muutos ilmoitetaan uudelleen.
    const rows = await tx.query<{ id: string }>(
      `update er_maintenance_works set project = $2, work_type = $3, completed_year = $4, completed_on = $5, cost_eur = $6, description = $7, performed_by = $8,
              share_group_id = $9, htj_submitted_at = null
        where id = $1 and company_id = $10 returning id`,
      [id, i.project, i.workType, year, i.completedOn, i.costEur, i.description, i.performedBy, i.shareGroupId, opts.companyId],
    );
    if (rows.length === 0) throw new MaintenanceError("Riviä ei löytynyt tai roolillasi ei voi muokata sitä.");
  } else {
    const [row] = await tx.query<{ id: string }>(
      `insert into er_maintenance_works (organization_id, company_id, project, work_type, completed_year, completed_on, cost_eur, description, performed_by, share_group_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [company.organization_id, opts.companyId, i.project, i.workType, year, i.completedOn, i.costEur, i.description, i.performedBy, i.shareGroupId],
    );
    id = row.id;
  }
  await audit(tx, { organizationId: company.organization_id, userId: opts.userId, action: opts.id ? "update" : "create", entity: "maintenance_work", entityId: id });
  return id!;
}

export interface NeedInput {
  plannedYear: number;
  target: string;
  action: string;
  workType: string | null;
  estimateEur: number | null;
  affectsResidents: boolean;
}

export async function addNeed(tx: Sql, opts: { companyId: string; userId: string; input: NeedInput }): Promise<string> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [opts.companyId]);
  if (!company) throw new MaintenanceError("Yhtiötä ei löytynyt.");
  const i = opts.input;
  const rows = await tx.query<{ id: string }>(
    `insert into er_maintenance_needs (organization_id, company_id, planned_year, target, action, work_type, estimate_eur, affects_residents)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [company.organization_id, opts.companyId, i.plannedYear, i.target, i.action, i.workType, i.estimateEur, i.affectsResidents],
  );
  await audit(tx, { organizationId: company.organization_id, userId: opts.userId, action: "create", entity: "maintenance_need", entityId: rows[0].id });
  return rows[0].id;
}

/**
 * Päivittää selvityksen rivin tilan. Kun rivi valmistuu, siitä tehdään
 * kunnossapitotyö historiaan (yhtiön tekemä) ja rivit linkitetään, jotta
 * samaa työtä ei kirjata kahdesti.
 */
export async function setNeedStatus(tx: Sql, opts: { id: string; companyId: string; userId: string; status: NeedStatus; plannedYear?: number | null; completedYear?: number | null }): Promise<void> {
  const [need] = await tx.query<{ id: string; organization_id: string; target: string; action: string; work_type: string | null; planned_year: number; maintenance_work_id: string | null; estimate_eur: string | null }>(
    "select id, organization_id, target, action, work_type, planned_year, maintenance_work_id, estimate_eur::text from er_maintenance_needs where id = $1 and company_id = $2",
    [opts.id, opts.companyId],
  );
  if (!need) throw new MaintenanceError("Riviä ei löytynyt.");
  let workId = need.maintenance_work_id;
  if (opts.status === "done" && !workId) {
    const year = opts.completedYear ?? need.planned_year;
    const [w] = await tx.query<{ id: string }>(
      `insert into er_maintenance_works (organization_id, company_id, project, work_type, completed_year, description, performed_by)
       values ($1,$2,$3,$4,$5,$6,'company') returning id`,
      [need.organization_id, opts.companyId, `${need.target}: ${need.action}`, isKnownWorkType(need.work_type) ? need.work_type : "Muu", year, "Kunnossapitotarveselvityksestä"],
    );
    workId = w.id;
  }
  const rows = await tx.query(
    `update er_maintenance_needs set status = $2, planned_year = coalesce($3, planned_year), maintenance_work_id = $4,
            htj_submitted_at = case when $3::smallint is not null and $3::smallint <> planned_year then null else htj_submitted_at end
      where id = $1 returning id`,
    [opts.id, opts.status, opts.plannedYear ?? null, workId],
  );
  if (rows.length === 0) throw new MaintenanceError("Roolillasi ei voi muokata riviä.");
  await audit(tx, { organizationId: need.organization_id, userId: opts.userId, action: "update", entity: "maintenance_need", entityId: opts.id, details: { status: opts.status } });
}
