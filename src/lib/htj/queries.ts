import type { Sql } from "@/lib/db";
import { findGaps, loadHtj2Data, obligationFor, reportState, unsubmittedRows, SUBMISSION_KINDS, type Gap, type ReportState } from "./htj2";
import type { Obligation } from "./obligation";
import type { DiffAction, DiffEntity, OwnershipSnapshot, ShareGroupSnapshot } from "./diff";

/** HTJ-näkymien lukukyselyt. Ajetaan käyttäjän RLS-transaktiossa. */

export interface CompanyHtjOverview {
  id: string;
  name: string;
  businessId: string;
  obligation: Obligation;
  gaps: Gap[];
  state: ReportState;
  unsubmitted: number;
  lastSync: { status: string; finished_at: string | null; started_at: string } | null;
  pendingDiffs: number;
  syncedAt: string | null;
}

export async function companyHtjOverview(tx: Sql, companyId: string, today: string): Promise<CompanyHtjOverview | null> {
  const data = await loadHtj2Data(tx, companyId, today);
  if (!data) return null;
  const [subs, [lastSync], [pending]] = await Promise.all([
    tx.query<{ status: string; created_at: string }>("select status, created_at::text from er_htj_submissions where company_id = $1", [companyId]),
    tx.query<{ status: string; finished_at: string | null; started_at: string }>(
      "select status, finished_at::text, started_at::text from er_htj_syncs where company_id = $1 and kind = 'fetch' order by started_at desc limit 1",
      [companyId],
    ),
    tx.query<{ n: number }>("select count(*)::int as n from er_htj_diffs where company_id = $1 and status = 'pending'", [companyId]),
  ]);
  const rows = unsubmittedRows(data);
  return {
    id: data.company.id,
    name: data.company.name,
    businessId: data.company.business_id,
    obligation: obligationFor(data),
    gaps: findGaps(data),
    state: reportState(subs),
    unsubmitted: SUBMISSION_KINDS.reduce((s, k) => s + rows[k].length, 0),
    lastSync: lastSync ?? null,
    pendingDiffs: pending.n,
    syncedAt: data.company.htj_synced_at,
  };
}

export async function listHtjOverview(tx: Sql, organizationId: string, today: string): Promise<CompanyHtjOverview[]> {
  const companies = await tx.query<{ id: string }>(
    "select id from er_housing_companies where organization_id = $1 and management_ended_on is null order by name",
    [organizationId],
  );
  const out: CompanyHtjOverview[] = [];
  for (const c of companies) {
    const o = await companyHtjOverview(tx, c.id, today);
    if (o) out.push(o);
  }
  return out;
}

export interface DiffRowView {
  id: string;
  entity: DiffEntity;
  action: DiffAction;
  label: string;
  before: ShareGroupSnapshot | OwnershipSnapshot | null;
  after: ShareGroupSnapshot | OwnershipSnapshot | null;
  created_at: string;
}

export function listPendingDiffs(tx: Sql, companyId: string) {
  return tx.query<DiffRowView>(
    "select id, entity, action, label, before, after, created_at::text from er_htj_diffs where company_id = $1 and status = 'pending' order by sort_order, label",
    [companyId],
  );
}

export function listSyncs(tx: Sql, companyId: string, limit = 10) {
  return tx.query<{ id: string; kind: string; target: string; status: string; started_at: string; finished_at: string | null; summary: Record<string, unknown>; error: string | null; started_by_name: string | null }>(
    `select s.id, s.kind, s.target, s.status, s.started_at::text, s.finished_at::text, s.summary, s.error, coalesce(u.full_name, u.email) as started_by_name
       from er_htj_syncs s left join er_users u on u.id = s.started_by
      where s.company_id = $1 order by s.started_at desc limit $2`,
    [companyId, limit],
  );
}

export function listSubmissions(tx: Sql, companyId: string) {
  return tx.query<{
    id: string; kind: string; status: string; payload: { items?: unknown[] }; created_at: string; sent_at: string | null; approved_at: string | null;
    error: string | null; note: string | null; prepared_by_name: string | null; approved_by_name: string | null; response: { reference?: string | null } | null;
  }>(
    `select s.id, s.kind, s.status, s.payload, s.created_at::text, s.sent_at::text, s.approved_at::text, s.error, s.note, s.response,
            coalesce(p.full_name, p.email) as prepared_by_name, coalesce(a.full_name, a.email) as approved_by_name
       from er_htj_submissions s
       left join er_users p on p.id = s.prepared_by
       left join er_users a on a.id = s.approved_by
      where s.company_id = $1 order by s.created_at desc limit 50`,
    [companyId],
  );
}

/** Hakuloki (RLS: vain pääkäyttäjä ja isännöitsijä näkevät rivit). */
export function listRequests(tx: Sql, companyId: string, limit = 20) {
  return tx.query<{ id: string; operation: string; scope: string | null; purpose: string; mode: string; outcome: string; created_at: string; user_name: string | null; result_count: number | null }>(
    `select r.id, r.operation, r.scope, r.purpose, r.mode, r.outcome, r.created_at::text, r.result_count, coalesce(u.full_name, u.email) as user_name
       from er_htj_requests r left join er_users u on u.id = r.user_id
      where r.company_id = $1 order by r.created_at desc limit $2`,
    [companyId, limit],
  );
}

export const REQUEST_OPERATION_LABEL: Record<string, string> = {
  company: "Yhtiön tiedot",
  share_groups: "Osakeryhmät",
  owners: "Omistajat",
  restrictions: "Rajoitukset",
  changes: "Muutostiedot",
  submit: "Ilmoitus",
};

export const REQUEST_PURPOSE_LABEL: Record<string, string> = {
  registry_sync: "Osakeluettelon vertailu",
  change_sync: "Muutostietojen yöajo",
  htj2_submission: "HTJ2-ilmoitus",
  manager_certificate: "Isännöitsijäntodistus",
  meeting: "Yhtiökokous",
};

export const SYNC_STATUS_LABEL: Record<string, string> = { running: "Käynnissä", ok: "Valmis", warnings: "Huomioita", error: "Virhe" };
