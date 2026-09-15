import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeRecurrence } from "@/lib/tasks/recurrence";
import { parseContent, RESCUE_PLAN_TEMPLATE_VERSION, type RescuePlanContent } from "./content";

/**
 * Pelastussuunnitelmien kyselyt ja muutokset. Ajetaan käyttäjän
 * RLS-transaktiossa. PDF:n renderöinti ja tiedoston tallennus ovat
 * transaktion ulkopuolella (document.tsx).
 */

export class RescuePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RescuePlanError";
  }
}

export type PlanStatus = "draft" | "final";
export type PlanVisibility = "internal" | "board" | "owners" | "residents";
export const PLAN_VISIBILITIES: PlanVisibility[] = ["residents", "owners", "board", "internal"];

export const REVIEW_TASK_KEY = "rescue_plan_review";
export const REVIEW_TASK_TITLE = "Pelastussuunnitelman tarkistus";

export interface PlanRow {
  id: string;
  organization_id: string;
  company_id: string;
  version: number;
  status: PlanStatus;
  template_version: number;
  content: RescuePlanContent;
  prepared_on: string | null;
  next_review_on: string | null;
  visibility: PlanVisibility;
  document_id: string | null;
  task_id: string | null;
  finalized_at: string | null;
  finalized_by_name: string | null;
  superseded_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

const COLUMNS = `p.id, p.organization_id, p.company_id, p.version, p.status, p.template_version, p.content,
  to_char(p.prepared_on, 'YYYY-MM-DD') as prepared_on, to_char(p.next_review_on, 'YYYY-MM-DD') as next_review_on,
  p.visibility, p.document_id, p.task_id, p.finalized_at, coalesce(f.full_name, f.email) as finalized_by_name,
  p.superseded_at, p.updated_at, coalesce(u.full_name, u.email) as updated_by_name`;
const FROM = `from er_rescue_plans p
  left join er_users f on f.id = p.finalized_by
  left join er_users u on u.id = p.updated_by`;

const mapRow = (r: PlanRow): PlanRow => ({ ...r, content: parseContent(r.content) });

export async function listPlans(tx: Sql, companyId: string): Promise<PlanRow[]> {
  const rows = await tx.query<PlanRow>(`select ${COLUMNS} ${FROM} where p.company_id = $1 order by p.version desc`, [companyId]);
  return rows.map(mapRow);
}

export async function getPlan(tx: Sql, planId: string): Promise<PlanRow | null> {
  const [row] = await tx.query<PlanRow>(`select ${COLUMNS} ${FROM} where p.id = $1`, [planId]);
  return row ? mapRow(row) : null;
}

/** Voimassa oleva valmis versio ja mahdollinen luonnos. */
export function currentAndDraft(plans: PlanRow[]): { current: PlanRow | null; draft: PlanRow | null } {
  return {
    current: plans.find((p) => p.status === "final" && !p.superseded_at) ?? null,
    draft: plans.find((p) => p.status === "draft") ?? null,
  };
}

/**
 * Luo luonnoksen. Sisältö annetaan kutsujalta: ensimmäisellä kerralla
 * esitäyttö rekisteristä, myöhemmin edellisen valmiin version sisältö.
 * Jos luonnos on jo olemassa, palautetaan se (tuplaklikkaus).
 */
export async function createDraft(
  tx: Sql,
  input: { organizationId: string; companyId: string; userId: string; content: RescuePlanContent; visibility?: PlanVisibility },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx.query<{ id: string }>("select id from er_rescue_plans where company_id = $1 and status = 'draft'", [input.companyId]);
  if (existing) return { id: existing.id, created: false };
  const [row] = await tx.query<{ id: string; version: number }>(
    `insert into er_rescue_plans (organization_id, company_id, version, status, template_version, content, visibility, created_by, updated_by)
     values ($1, $2, coalesce((select max(version) from er_rescue_plans where company_id = $2), 0) + 1, 'draft', $3, $4, $5, $6, $6)
     returning id, version`,
    [input.organizationId, input.companyId, RESCUE_PLAN_TEMPLATE_VERSION, JSON.stringify(input.content), input.visibility ?? "residents", input.userId],
  );
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "create", entity: "rescue_plan", entityId: row.id, details: { version: row.version } });
  return { id: row.id, created: true };
}

export async function saveDraft(
  tx: Sql,
  input: { planId: string; userId: string; content: RescuePlanContent; preparedOn: string | null; nextReviewOn: string | null; visibility: PlanVisibility },
): Promise<void> {
  const rows = await tx.query<{ id: string }>(
    `update er_rescue_plans set content = $2, prepared_on = $3, next_review_on = $4, visibility = $5, template_version = $6, updated_by = $7
      where id = $1 and status = 'draft' returning id`,
    [input.planId, JSON.stringify(input.content), input.preparedOn, input.nextReviewOn, input.visibility, RESCUE_PLAN_TEMPLATE_VERSION, input.userId],
  );
  if (rows.length === 0) throw new RescuePlanError("Luonnosta ei löytynyt. Se on ehkä jo merkitty valmiiksi.");
}

export async function deleteDraft(tx: Sql, input: { planId: string; userId: string }): Promise<boolean> {
  const [row] = await tx.query<{ organization_id: string; version: number }>(
    "delete from er_rescue_plans where id = $1 and status = 'draft' returning organization_id, version",
    [input.planId],
  );
  if (!row) return false;
  await audit(tx, { organizationId: row.organization_id, userId: input.userId, action: "delete", entity: "rescue_plan", entityId: input.planId, details: { version: row.version } });
  return true;
}

export interface StoredPlanDocument {
  title: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Merkitsee luonnoksen valmiiksi yhdessä transaktiossa: dokumenttirivi,
 * edellisen version korvautuminen (sen PDF sisäiseksi, jotta asukkaat
 * näkevät vain voimassa olevan), vuosikellon tarkistustehtävä ja loki.
 */
export async function finalizeDraft(
  tx: Sql,
  input: { planId: string; userId: string; document: StoredPlanDocument },
): Promise<{ documentId: string; taskId: string; supersededId: string | null }> {
  const [plan] = await tx.query<{
    id: string; organization_id: string; company_id: string; version: number; status: PlanStatus;
    prepared_on: string | null; next_review_on: string | null; visibility: PlanVisibility;
  }>(
    `select id, organization_id, company_id, version, status, to_char(prepared_on, 'YYYY-MM-DD') as prepared_on,
            to_char(next_review_on, 'YYYY-MM-DD') as next_review_on, visibility
       from er_rescue_plans where id = $1 for update`,
    [input.planId],
  );
  if (!plan) throw new RescuePlanError("Suunnitelmaa ei löytynyt.");
  if (plan.status !== "draft") throw new RescuePlanError("Versio on jo merkitty valmiiksi.");
  if (!plan.prepared_on || !plan.next_review_on) throw new RescuePlanError("Anna laatimispäivä ja seuraavan tarkistuksen päivä.");
  if (plan.next_review_on <= plan.prepared_on) throw new RescuePlanError("Seuraavan tarkistuksen on oltava laatimispäivän jälkeen.");

  const [doc] = await tx.query<{ id: string }>(
    `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year, uploaded_by)
     values ($1,$2,'rescue_plan',$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [plan.organization_id, plan.company_id, input.document.title, input.document.fileName, input.document.storagePath, input.document.mimeType,
      input.document.sizeBytes, input.document.sha256, plan.visibility, Number(plan.prepared_on.slice(0, 4)), input.userId],
  );

  const [previous] = await tx.query<{ id: string; document_id: string | null }>(
    `update er_rescue_plans set superseded_at = now(), updated_by = $2
      where company_id = $1 and status = 'final' and superseded_at is null returning id, document_id`,
    [plan.company_id, input.userId],
  );
  if (previous?.document_id) {
    await tx.query("update er_documents set visibility = 'internal' where id = $1", [previous.document_id]);
  }

  const taskId = await upsertReviewTask(tx, {
    organizationId: plan.organization_id, companyId: plan.company_id, dueOn: plan.next_review_on, userId: input.userId, version: plan.version,
  });

  await tx.query(
    `update er_rescue_plans set status = 'final', finalized_at = now(), finalized_by = $2, document_id = $3, task_id = $4, updated_by = $2
      where id = $1`,
    [plan.id, input.userId, doc.id, taskId],
  );
  await audit(tx, {
    organizationId: plan.organization_id, userId: input.userId, action: "finalize", entity: "rescue_plan", entityId: plan.id,
    details: { version: plan.version, documentId: doc.id, taskId, supersededId: previous?.id ?? null },
  });
  return { documentId: doc.id, taskId, supersededId: previous?.id ?? null };
}

/**
 * Vuosikellon tehtävä "Pelastussuunnitelman tarkistus". Yhtiöllä on yksi avoin
 * tehtävä: uusi versio siirtää sen eräpäivän, ja kuitattu tehtävä toistuu
 * vuosittain vuosikellon tavalliseen tapaan.
 */
export async function upsertReviewTask(
  tx: Sql,
  input: { organizationId: string; companyId: string; dueOn: string; userId: string; version: number },
): Promise<string> {
  const description = `Tarkista pelastussuunnitelma (versio ${input.version}): vastuuhenkilöt, yhteystiedot, riskit, pääsulut, kokoontumispaikka ja väestönsuojelu. Laadi tarvittaessa uusi versio eRapussa ja tiedota asukkaille.`;
  const recurrence = JSON.stringify(normalizeRecurrence({ freq: "yearly", interval: 1 }, input.dueOn));
  const [open] = await tx.query<{ id: string }>(
    "select id from er_tasks where company_id = $1 and template_key = $2 and done_at is null order by due_on limit 1 for update",
    [input.companyId, REVIEW_TASK_KEY],
  );
  if (open) {
    // Sarjan kuitatulla esiintymällä voi jo olla sama eräpäivä (uniikki series_id + due_on).
    // Silloin avoin tehtävä kuitataan tehdyksi (uusi versio on tarkistus) ja luodaan uusi.
    const moved = await tx.query<{ id: string }>(
      `update er_tasks t set due_on = $2, description = $3, recurrence = $4
        where t.id = $1 and not exists (select 1 from er_tasks o where o.series_id = t.series_id and o.due_on = $2::date and o.id <> t.id)
        returning t.id`,
      [open.id, input.dueOn, description, recurrence],
    );
    if (moved.length) return open.id;
    await tx.query("update er_tasks set done_at = now(), done_by = $2 where id = $1", [open.id, input.userId]);
  }
  const [manager] = await tx.query<{ user_id: string | null }>(
    `select (select m.user_id from er_org_members m where m.organization_id = c.organization_id and m.user_id = c.manager_user_id) as user_id
       from er_housing_companies c where c.id = $1`,
    [input.companyId],
  );
  const [row] = await tx.query<{ id: string }>(
    `insert into er_tasks (organization_id, company_id, title, description, due_on, recurrence, category, assignee_user_id, created_by, template_key)
     values ($1,$2,$3,$4,$5,$6,'safety',$7,$8,$9) returning id`,
    [input.organizationId, input.companyId, REVIEW_TASK_TITLE, description, input.dueOn, recurrence, manager?.user_id ?? null, input.userId, REVIEW_TASK_KEY],
  );
  return row.id;
}

/** Yhtiön tason pohjapiirustukset ja asemapiirrokset liitteiksi. */
export async function listAttachmentCandidates(tx: Sql, companyId: string) {
  return tx.query<{ id: string; title: string; mime_type: string; size_bytes: string; storage_path: string; year: number | null }>(
    `select id, title, mime_type, size_bytes, storage_path, year from er_documents
      where company_id = $1 and share_group_id is null and category = 'floor_plan' and subject_table is null
      order by created_at desc limit 50`,
    [companyId],
  );
}
