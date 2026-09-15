import type { Sql } from "@/lib/db/types";
import { getBillingSettings, loadBillableGroups, loadChargeBases, type BillingSettings } from "./billing";
import { chargesForGroup, effectiveBasis, type BillableGroup, type ChargeBasisInput, type Period } from "./charges";
import { monthPeriod } from "./dates";
import { centsToDecimal, toCents } from "./money";
import { companyReference } from "./references";

/**
 * Talouden lukukyselyt sivuille ja nostoille. Ajetaan käyttäjän
 * RLS-transaktiossa; päivämäärät ja rahat palautetaan tekstinä, jotta
 * laskenta pysyy kokonaisluvuissa.
 */

export type BasisRow = Awaited<ReturnType<typeof loadChargeBases>>[number];

export function currentMonth(today: string): string {
  return today.slice(0, 7);
}

/** Voimassa oleva hoitovastike €/m²/kk asuinhuoneistoille, jos peruste on pinta-ala. */
export function maintenanceRate(bases: ChargeBasisInput[], today: string): string | null {
  const b = effectiveBasis(bases, "maintenance", today, "apartment");
  return b && b.basis === "area_m2" ? b.unit_price : null;
}

export function accrualCents(bases: ChargeBasisInput[], groups: BillableGroup[], period: Period): bigint {
  let total = 0n;
  for (const g of groups) for (const l of chargesForGroup(bases, g, period).lines) total += l.amountCents;
  return total;
}

export interface CompanyFinanceRow {
  id: string;
  name: string;
  maintenanceRate: string | null;
  monthlyAccrual: string;
  openEur: string | null;
  overdueEur: string | null;
  asOf: string | null;
  latestRun: { id: string; period_start: string; status: string } | null;
  currentRunDone: boolean;
  hasSettings: boolean;
  loansEur: string;
}

export async function financeOverview(tx: Sql, organizationId: string, today: string): Promise<CompanyFinanceRow[]> {
  const companies = await tx.query<{
    id: string; name: string; latest_run: { id: string; period_start: string; status: string } | null; current_run: boolean;
    has_settings: boolean; as_of: string | null; open_eur: string | null; overdue_eur: string | null; loans_eur: string;
  }>(
    `select c.id, c.name,
            (select json_build_object('id', r.id, 'period_start', r.period_start::text, 'status', r.status)
               from er_billing_runs r where r.company_id = c.id and r.status <> 'cancelled'
              order by r.period_start desc limit 1) as latest_run,
            exists (select 1 from er_billing_runs r where r.company_id = c.id and r.status <> 'cancelled' and r.period_start = $2::date) as current_run,
            exists (select 1 from er_company_billing_settings s where s.company_id = c.id) as has_settings,
            ps.as_of, ps.open_eur, ps.overdue_eur,
            (select coalesce(sum(coalesce(l.balance_eur, l.principal_eur)), 0)::text from er_loans l where l.company_id = c.id) as loans_eur
       from er_housing_companies c
       left join lateral (
         select s.as_of::text, sum(s.open_eur)::text as open_eur, sum(s.overdue_eur)::text as overdue_eur
           from er_payment_status s
          where s.company_id = c.id and s.as_of = (select max(x.as_of) from er_payment_status x where x.company_id = c.id)
          group by s.as_of
       ) ps on true
      where c.organization_id = $1 and c.management_ended_on is null
      order by c.name`,
    [organizationId, monthPeriod(currentMonth(today)).start],
  );
  if (companies.length === 0) return [];

  const bases = await tx.query<ChargeBasisInput & { company_id: string }>(
    `select company_id, id, charge_type, label, basis, unit_price::text, vat_percent::text, applies_to_kinds, starts_on::text, ends_on::text
       from er_charge_bases where organization_id = $1`,
    [organizationId],
  );
  const groups = await tx.query<BillableGroup & { company_id: string }>(
    `select g.company_id, g.id, g.unit_label, g.kind, g.area_m2::text, g.share_count,
            (select count(*)::int from er_residencies r where r.share_group_id = g.id and (r.ends_on is null or r.ends_on >= $2::date)) as resident_count
       from er_share_groups g where g.organization_id = $1 and g.removed_on is null`,
    [organizationId, today],
  );
  const period = monthPeriod(currentMonth(today));

  return companies.map((c) => {
    const cb = bases.filter((b) => b.company_id === c.id);
    const cg = groups.filter((g) => g.company_id === c.id);
    return {
      id: c.id,
      name: c.name,
      maintenanceRate: maintenanceRate(cb, today),
      monthlyAccrual: centsToDecimal(accrualCents(cb, cg, period)),
      openEur: c.open_eur,
      overdueEur: c.overdue_eur,
      asOf: c.as_of,
      latestRun: c.latest_run,
      currentRunDone: c.current_run,
      hasSettings: c.has_settings,
      loansEur: c.loans_eur,
    };
  });
}

export interface LoanRow {
  id: string;
  name: string;
  lender: string | null;
  principal_eur: string;
  balance_eur: string | null;
  balance_date: string | null;
  drawn_on: string | null;
  due_on: string | null;
  interest_terms: string | null;
  undrawn_eur: string;
  allocated: boolean;
  purpose: string | null;
  source: string;
  loan_type: string | null;
  reference_rate: string | null;
  margin_percent: string | null;
  interest_percent: string | null;
  undrawn_estimated_on: string | null;
  share_count: number;
  shares_original: string;
  shares_remaining: string;
  paid_off_count: number;
}

export async function listLoans(tx: Sql, companyId: string): Promise<LoanRow[]> {
  return tx.query<LoanRow>(
    `select l.id, l.name, l.lender, l.principal_eur::text, l.balance_eur::text, l.balance_date::text, l.drawn_on::text, l.due_on::text,
            l.interest_terms, l.undrawn_eur::text, l.allocated, l.purpose, l.source,
            l.loan_type, l.reference_rate, l.margin_percent::text, l.interest_percent::text, l.undrawn_estimated_on::text,
            (select count(*)::int from er_loan_shares s where s.loan_id = l.id) as share_count,
            (select coalesce(sum(s.original_eur), 0)::text from er_loan_shares s where s.loan_id = l.id) as shares_original,
            (select coalesce(sum(s.remaining_eur), 0)::text from er_loan_shares s where s.loan_id = l.id) as shares_remaining,
            (select count(*)::int from er_loan_shares s where s.loan_id = l.id and s.paid_off_on is not null) as paid_off_count
       from er_loans l where l.company_id = $1
      order by l.drawn_on desc nulls last, l.name`,
    [companyId],
  );
}

export interface MortgageRow {
  id: string;
  property_id: string | null;
  property_code: string | null;
  amount_eur: string;
  holder: string | null;
  registered_on: string | null;
  notes: string | null;
}

export async function listMortgages(tx: Sql, companyId: string): Promise<MortgageRow[]> {
  return tx.query<MortgageRow>(
    `select m.id, m.property_id, p.property_code, m.amount_eur::text, m.holder, m.registered_on::text, m.notes
       from er_property_mortgages m left join er_properties p on p.id = m.property_id
      where m.company_id = $1 order by m.registered_on nulls last, m.created_at`,
    [companyId],
  );
}

export interface LoanShareRow {
  id: string;
  share_group_id: string;
  unit_label: string;
  share_count: number;
  original_eur: string;
  remaining_eur: string;
  balance_date: string;
  paid_off_on: string | null;
}

export async function listLoanShares(tx: Sql, loanId: string): Promise<LoanShareRow[]> {
  return tx.query<LoanShareRow>(
    `select s.id, s.share_group_id, g.unit_label, g.share_count, s.original_eur::text, s.remaining_eur::text, s.balance_date::text, s.paid_off_on::text
       from er_loan_shares s join er_share_groups g on g.id = s.share_group_id
      where s.loan_id = $1`,
    [loanId],
  ).then((rows) => rows.sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true })));
}

export interface RunRow {
  id: string;
  period_start: string;
  period_end: string;
  due_on: string | null;
  status: string;
  totals: { total_eur?: string; line_count?: number; group_count?: number; missing_payer_count?: number; warnings?: string[]; by_charge_type?: Record<string, string> };
  created_at: string;
  approved_at: string | null;
  exported_at: string | null;
  export_document_id: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
}

export async function listRuns(tx: Sql, companyId: string, limit = 24): Promise<RunRow[]> {
  return tx.query<RunRow>(
    `select r.id, r.period_start::text, r.period_end::text, r.due_on::text, r.status, r.totals, r.created_at, r.approved_at, r.exported_at,
            r.export_document_id, coalesce(cu.full_name, cu.email) as created_by_name, coalesce(au.full_name, au.email) as approved_by_name
       from er_billing_runs r
       left join er_users cu on cu.id = r.created_by
       left join er_users au on au.id = r.approved_by
      where r.company_id = $1
      order by r.period_start desc, r.created_at desc limit $2`,
    [companyId, limit],
  );
}

export async function getRun(tx: Sql, companyId: string, runId: string): Promise<RunRow | null> {
  const [row] = await tx.query<RunRow>(
    `select r.id, r.period_start::text, r.period_end::text, r.due_on::text, r.status, r.totals, r.created_at, r.approved_at, r.exported_at,
            r.export_document_id, coalesce(cu.full_name, cu.email) as created_by_name, coalesce(au.full_name, au.email) as approved_by_name
       from er_billing_runs r
       left join er_users cu on cu.id = r.created_by
       left join er_users au on au.id = r.approved_by
      where r.company_id = $1 and r.id = $2`,
    [companyId, runId],
  );
  return row ?? null;
}

export interface RunLineRow {
  id: string;
  share_group_id: string;
  unit_label: string;
  payer_name: string | null;
  charge_type: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount_eur: string;
  vat_percent: string;
  reference_number: string;
}

export async function listRunLines(tx: Sql, runId: string): Promise<RunLineRow[]> {
  const rows = await tx.query<RunLineRow>(
    `select l.id, l.share_group_id, g.unit_label, p.display_name as payer_name, l.charge_type, l.description, l.quantity::text,
            l.unit_price::text, l.amount_eur::text, l.vat_percent::text, l.reference_number
       from er_billing_lines l
       join er_share_groups g on g.id = l.share_group_id
       left join er_parties p on p.id = l.payer_party_id
      where l.run_id = $1`,
    [runId],
  );
  return rows.sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }) || a.charge_type.localeCompare(b.charge_type));
}

export interface ImportRow {
  id: string;
  file_name: string;
  as_of: string;
  rows: number;
  matched: number;
  unmatched: { line: number; reference: string | null; unit_label: string | null; open_eur: string; overdue_eur: string; reason: string }[];
  created_at: string;
  imported_by_name: string | null;
}

export async function listImports(tx: Sql, companyId: string, limit = 10): Promise<ImportRow[]> {
  return tx.query<ImportRow>(
    `select i.id, i.file_name, i.as_of::text, i.rows, i.matched, i.unmatched, i.created_at, coalesce(u.full_name, u.email) as imported_by_name
       from er_payment_imports i left join er_users u on u.id = i.imported_by
      where i.company_id = $1 order by i.created_at desc limit $2`,
    [companyId, limit],
  );
}

export interface UnitFinanceRow {
  id: string;
  unit_label: string;
  kind: string;
  area_m2: string | null;
  share_count: number;
  seq_no: number | null;
  reference: string | null;
  monthly_eur: string;
  open_eur: string | null;
  overdue_eur: string | null;
  oldest_due_on: string | null;
  as_of: string | null;
}

/** Osakeryhmät viitteineen, kuukausivastikkeineen ja viimeisimmän maksutilanteen kanssa. */
export async function listUnitFinance(tx: Sql, companyId: string, today: string, settings: BillingSettings | null, bases?: ChargeBasisInput[]): Promise<UnitFinanceRow[]> {
  const b = bases ?? (await loadChargeBases(tx, companyId));
  const groups = await loadBillableGroups(tx, companyId, today);
  const extra = await tx.query<{ id: string; seq_no: number | null; open_eur: string | null; overdue_eur: string | null; oldest_due_on: string | null; as_of: string | null }>(
    `select g.id, n.seq_no, s.open_eur::text, s.overdue_eur::text, s.oldest_due_on::text, s.as_of::text
       from er_share_groups g
       left join er_billing_unit_numbers n on n.share_group_id = g.id
       left join lateral (select * from er_payment_status x where x.share_group_id = g.id order by x.as_of desc limit 1) s on true
      where g.company_id = $1 and g.removed_on is null`,
    [companyId],
  );
  const byId = new Map(extra.map((e) => [e.id, e]));
  const period = monthPeriod(currentMonth(today));
  return groups
    .filter((g) => byId.has(g.id))
    .map((g) => {
      const e = byId.get(g.id)!;
      return {
        id: g.id,
        unit_label: g.unit_label,
        kind: g.kind,
        area_m2: g.area_m2,
        share_count: g.share_count,
        seq_no: e.seq_no,
        reference: settings && e.seq_no ? companyReference(settings.company_number, e.seq_no) : null,
        monthly_eur: centsToDecimal(chargesForGroup(b, g, period).lines.reduce((s, l) => s + l.amountCents, 0n)),
        open_eur: e.open_eur,
        overdue_eur: e.overdue_eur,
        oldest_due_on: e.oldest_due_on,
        as_of: e.as_of,
      };
    })
    .sort((a, b2) => a.unit_label.localeCompare(b2.unit_label, "fi", { numeric: true }));
}

export function sumEur(values: (string | null | undefined)[]): string {
  return centsToDecimal(values.reduce((s, v) => s + (v ? toCents(v) : 0n), 0n));
}

export { getBillingSettings, loadChargeBases };
