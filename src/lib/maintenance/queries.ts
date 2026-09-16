import type { Sql } from "@/lib/db";
import type { RenovationStatus } from "./renovation";

/** Korjaukset-välilehden ja portaalin kyselyt. RLS rajaa rivit. */

export interface WorkRow {
  id: string;
  project: string;
  work_type: string;
  completed_year: number | null;
  completed_on: string | null;
  cost_eur: string | null;
  description: string | null;
  performed_by: "company" | "shareholder";
  share_group_id: string | null;
  unit_label: string | null;
  building_id: string | null;
  source: string;
  htj_submitted_at: string | null;
}

export function listWorks(tx: Sql, companyId: string) {
  return tx.query<WorkRow>(
    `select w.id, w.project, w.work_type, w.completed_year, w.completed_on::text, w.cost_eur::text, w.description, w.performed_by,
            w.share_group_id, g.unit_label, w.building_id, w.source, w.htj_submitted_at::text
       from er_maintenance_works w left join er_share_groups g on g.id = w.share_group_id
      where w.company_id = $1 order by w.completed_year desc nulls first, w.created_at desc`,
    [companyId],
  );
}

export interface NeedRow {
  id: string;
  planned_year: number;
  target: string;
  action: string;
  work_type: string | null;
  estimate_eur: string | null;
  affects_residents: boolean;
  status: string;
  maintenance_work_id: string | null;
  htj_submitted_at: string | null;
  decided_on: string | null;
}

const NEED_COLUMNS = "id, planned_year, target, action, work_type, estimate_eur::text, affects_residents, status, maintenance_work_id, htj_submitted_at::text, decided_on::text";

export function listNeeds(tx: Sql, companyId: string, fromYear: number, toYear: number) {
  return tx.query<NeedRow>(
    `select ${NEED_COLUMNS}
       from er_maintenance_needs where company_id = $1 and planned_year between $2 and $3
      order by planned_year, target`,
    [companyId, fromYear, toYear],
  );
}

/** Päätetyt ja käynnissä olevat korjaukset vuodesta riippumatta (isännöitsijäntodistus, VNa 365/2010 5 § 12 kohta). */
export function listDecidedNeeds(tx: Sql, companyId: string) {
  return tx.query<NeedRow>(
    `select ${NEED_COLUMNS}
       from er_maintenance_needs where company_id = $1 and status in ('decided', 'in_progress')
      order by case status when 'in_progress' then 0 else 1 end, planned_year, target`,
    [companyId],
  );
}

export interface NoticeRow {
  id: string;
  company_id: string;
  company_name: string;
  share_group_id: string;
  unit_label: string;
  description: string;
  /** Vanha yhden työn sarake. Uusissa ilmoituksissa tyhjä: työlajit ovat `work_types`. */
  work_type: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: RenovationStatus;
  conditions: string | null;
  supervisor: string | null;
  decided_on: string | null;
  completed_on: string | null;
  maintenance_work_id: string | null;
  submitted_by_name: string | null;
  submitted_by_user_id: string | null;
  guide_acknowledged_at: string | null;
  guide_document_id: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  /** Työrivien määrä ja työlajit (er_renovation_notice_works). */
  work_count: number;
  work_types: string | null;
  /** Aikaisin aloitus ja myöhäisin valmistuminen työriveiltä. */
  works_start: string | null;
  works_end: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
}

const NOTICE_SELECT = `
  select n.id, n.company_id, c.name as company_name, n.share_group_id, g.unit_label, n.description, n.work_type,
         n.planned_start::text, n.planned_end::text, n.status, n.conditions, n.supervisor, n.decided_on::text, n.completed_on::text,
         n.maintenance_work_id, p.display_name as submitted_by_name, n.submitted_by_user_id,
         n.guide_acknowledged_at::text, n.guide_document_id, n.notify_email, n.notify_sms,
         coalesce(w.work_count, 0) as work_count, w.work_types, w.works_start::text, w.works_end::text,
         coalesce(a.attachment_count, 0) as attachment_count,
         n.created_at::text, n.updated_at::text
    from er_renovation_notices n
    join er_housing_companies c on c.id = n.company_id
    join er_share_groups g on g.id = n.share_group_id
    left join er_parties p on p.id = n.submitted_by_party_id
    left join lateral (
      select count(*)::int as work_count, string_agg(distinct rw.work_type, ', ') as work_types,
             min(rw.planned_start) as works_start, max(rw.planned_end) as works_end
        from er_renovation_notice_works rw where rw.notice_id = n.id
    ) w on true
    left join lateral (
      select count(*)::int as attachment_count from er_documents d
       where d.subject_table = 'er_renovation_notices' and d.subject_id = n.id
    ) a on true`;

export interface NoticeWorkRow {
  id: string;
  notice_id: string;
  sort_order: number;
  work_type: string;
  description: string;
  planned_start: string | null;
  planned_end: string | null;
  contractor_kind: string;
  contractor_name: string | null;
  contractor_business_id: string | null;
  contractor_contact: string | null;
  contractor_qualification: string | null;
  maintenance_work_id: string | null;
}

const WORK_COLUMNS =
  "id, notice_id, sort_order, work_type, description, planned_start::text, planned_end::text, contractor_kind, contractor_name, contractor_business_id, contractor_contact, contractor_qualification, maintenance_work_id";

export function listNoticeWorks(tx: Sql, noticeId: string) {
  return tx.query<NoticeWorkRow>(`select ${WORK_COLUMNS} from er_renovation_notice_works where notice_id = $1 order by sort_order`, [noticeId]);
}

/** Työrivit usealle ilmoitukselle kerralla (portaalin lista). */
export function listNoticeWorksFor(tx: Sql, noticeIds: string[]): Promise<NoticeWorkRow[]> {
  if (noticeIds.length === 0) return Promise.resolve([]);
  return tx.query<NoticeWorkRow>(
    `select ${WORK_COLUMNS} from er_renovation_notice_works where notice_id = any($1::uuid[]) order by notice_id, sort_order`,
    [noticeIds],
  );
}

export interface NoticeAttachmentRow {
  id: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: string;
}

export function listNoticeAttachments(tx: Sql, noticeId: string) {
  return tx.query<NoticeAttachmentRow>(
    `select id, title, file_name, mime_type, size_bytes::text, created_at::text from er_documents
      where subject_table = 'er_renovation_notices' and subject_id = $1 order by created_at`,
    [noticeId],
  );
}

export interface RenovationGuideRow {
  id: string;
  company_id: string;
  company_name: string | null;
  title: string;
  created_at: string;
}

/**
 * Yhtiöiden muutostyöohjeet (uusin kustakin yhtiöstä). RLS rajaa rivit, joten
 * osakas näkee ohjeen vain, jos se on tallennettu osakkaille näkyvänä.
 */
export function listRenovationGuides(tx: Sql, companyIds: string[]): Promise<RenovationGuideRow[]> {
  if (companyIds.length === 0) return Promise.resolve([]);
  return tx.query<RenovationGuideRow>(
    `select distinct on (d.company_id) d.id, d.company_id, c.name as company_name, d.title, d.created_at::text
       from er_documents d left join er_housing_companies c on c.id = d.company_id
      where d.category = 'renovation_guide' and d.share_group_id is null and d.company_id = any($1::uuid[])
      order by d.company_id, d.year desc nulls last, d.created_at desc`,
    [companyIds],
  );
}

export function listNotices(tx: Sql, companyId: string) {
  return tx.query<NoticeRow>(`${NOTICE_SELECT} where n.company_id = $1 order by n.created_at desc`, [companyId]);
}

export async function getNotice(tx: Sql, id: string): Promise<NoticeRow | null> {
  const [row] = await tx.query<NoticeRow>(`${NOTICE_SELECT} where n.id = $1`, [id]);
  return row ?? null;
}

/** Portaali: kaikki ilmoitukset, jotka käyttäjä näkee (omat huoneistot ja hallituksen yhtiöt). */
export function listPortalNotices(tx: Sql) {
  return tx.query<NoticeRow>(`${NOTICE_SELECT} order by n.created_at desc limit 100`);
}
