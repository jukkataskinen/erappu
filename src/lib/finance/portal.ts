import type { Sql } from "@/lib/db/types";
import type { PortalGrant } from "@/lib/auth/current-user";
import { chargesForGroup, isEffectiveOn, type ChargeBasisInput } from "./charges";
import { monthPeriod } from "./dates";
import { centsToDecimal, toCents } from "./money";
import { companyReference } from "./references";

/**
 * Portaalin talousnäkymät. Kyselyt ajetaan portaalikäyttäjän
 * RLS-transaktiossa: osakas saa vain oman osakeryhmänsä rivit ja hallitus
 * yhtiön summat (er_board_payment_summary), ei muiden osakkaiden tietoja.
 */

export interface OwnerUnitFinance {
  shareGroupId: string;
  companyId: string;
  companyName: string;
  unitLabel: string;
  areaM2: string | null;
  shareCount: number;
  reference: string | null;
  iban: string | null;
  bic: string | null;
  dueDay: number | null;
  charges: { description: string; amount: string }[];
  monthlyTotal: string;
  lastBilled: { periodStart: string; dueOn: string | null; lines: { description: string; amount: string }[]; total: string } | null;
  loanShares: { loanName: string; originalEur: string; remainingEur: string; balanceDate: string; paidOffOn: string | null; dueOn: string | null }[];
  payment: { asOf: string; openEur: string; overdueEur: string; oldestDueOn: string | null } | null;
}

async function companyBases(tx: Sql, companyId: string): Promise<ChargeBasisInput[]> {
  return tx.query<ChargeBasisInput>(
    `select id, charge_type, label, basis, unit_price::text, vat_percent::text, applies_to_kinds, starts_on::text, ends_on::text
       from er_charge_bases where company_id = $1`,
    [companyId],
  );
}

export async function ownerUnitFinance(tx: Sql, grants: PortalGrant[], today: string): Promise<OwnerUnitFinance[]> {
  const own = [...new Map(grants.filter((g) => g.role === "owner" && g.shareGroupId).map((g) => [g.shareGroupId, g])).values()];
  const period = monthPeriod(today.slice(0, 7));
  const out: OwnerUnitFinance[] = [];
  const basesByCompany = new Map<string, ChargeBasisInput[]>();

  for (const g of own) {
    const [group] = await tx.query<{ id: string; unit_label: string; kind: string; area_m2: string | null; share_count: number }>(
      "select id, unit_label, kind, area_m2::text, share_count from er_share_groups where id = $1",
      [g.shareGroupId],
    );
    if (!group) continue;
    if (!basesByCompany.has(g.companyId)) basesByCompany.set(g.companyId, await companyBases(tx, g.companyId));
    const bases = basesByCompany.get(g.companyId)!;
    const [settings] = await tx.query<{ company_number: number; bank_iban: string | null; bank_bic: string | null; due_day: number }>(
      "select company_number, bank_iban, bank_bic, due_day from er_company_billing_settings where company_id = $1",
      [g.companyId],
    );
    const [num] = await tx.query<{ seq_no: number }>("select seq_no from er_billing_unit_numbers where share_group_id = $1", [group.id]);
    const charges = chargesForGroup(bases, { ...group, resident_count: null }, period).lines;

    // Viimeisin hyväksytty laskutus. Osakas ei lue ajotaulua, joten kausi
    // haetaan er_portal_billing_run_periods()-funktiolla.
    const lines = await tx.query<{ period_start: string; due_on: string | null; description: string; amount_eur: string }>(
      `with last as (
         select p.run_id, p.period_start, p.due_on from er_portal_billing_run_periods() p
          where exists (select 1 from er_billing_lines x where x.run_id = p.run_id and x.share_group_id = $1)
          order by p.period_start desc limit 1
       )
       select last.period_start::text, last.due_on::text, l.description, l.amount_eur::text
         from er_billing_lines l join last on last.run_id = l.run_id
        where l.share_group_id = $1
        order by l.charge_type, l.description`,
      [group.id],
    );

    const loanShares = await tx.query<{ loan_name: string; original_eur: string; remaining_eur: string; balance_date: string; paid_off_on: string | null; due_on: string | null }>(
      `select l.name as loan_name, s.original_eur::text, s.remaining_eur::text, s.balance_date::text, s.paid_off_on::text, l.due_on::text
         from er_loan_shares s join er_loans l on l.id = s.loan_id where s.share_group_id = $1 order by l.name`,
      [group.id],
    );
    const [payment] = await tx.query<{ as_of: string; open_eur: string; overdue_eur: string; oldest_due_on: string | null }>(
      "select as_of::text, open_eur::text, overdue_eur::text, oldest_due_on::text from er_payment_status where share_group_id = $1 order by as_of desc limit 1",
      [group.id],
    );

    out.push({
      shareGroupId: group.id,
      companyId: g.companyId,
      companyName: g.companyName,
      unitLabel: group.unit_label,
      areaM2: group.area_m2,
      shareCount: group.share_count,
      reference: settings && num ? companyReference(settings.company_number, num.seq_no) : null,
      iban: settings?.bank_iban ?? null,
      bic: settings?.bank_bic ?? null,
      dueDay: settings?.due_day ?? null,
      charges: charges.map((c) => ({ description: c.description, amount: centsToDecimal(c.amountCents) })),
      monthlyTotal: centsToDecimal(charges.reduce((s, c) => s + c.amountCents, 0n)),
      lastBilled: lines.length
        ? {
            periodStart: lines[0].period_start,
            dueOn: lines[0].due_on,
            lines: lines.map((l) => ({ description: l.description, amount: l.amount_eur })),
            total: centsToDecimal(lines.reduce((s, l) => s + toCents(l.amount_eur), 0n)),
          }
        : null,
      loanShares: loanShares.map((s) => ({ loanName: s.loan_name, originalEur: s.original_eur, remainingEur: s.remaining_eur, balanceDate: s.balance_date, paidOffOn: s.paid_off_on, dueOn: s.due_on })),
      payment: payment ? { asOf: payment.as_of, openEur: payment.open_eur, overdueEur: payment.overdue_eur, oldestDueOn: payment.oldest_due_on } : null,
    });
  }
  return out;
}

export interface BoardCompanyFinance {
  companyId: string;
  companyName: string;
  bases: (ChargeBasisInput & { decided_on: string | null })[];
  loans: { id: string; name: string; lender: string | null; principal_eur: string; balance_eur: string | null; balance_date: string | null; due_on: string | null; shares_remaining: string; paid_off_count: number }[];
  runs: { id: string; period_start: string; status: string; totals: { total_eur?: string; line_count?: number; by_charge_type?: Record<string, string> } }[];
  payment: { as_of: string; open_eur: string; overdue_eur: string; overdue_units: number; units: number } | null;
}

export async function boardCompanyFinance(tx: Sql, company: { id: string; name: string }, today: string): Promise<BoardCompanyFinance> {
  const bases = await tx.query<ChargeBasisInput & { decided_on: string | null }>(
    `select id, charge_type, label, basis, unit_price::text, vat_percent::text, applies_to_kinds, starts_on::text, ends_on::text, decided_on::text
       from er_charge_bases where company_id = $1 order by charge_type, starts_on desc`,
    [company.id],
  );
  const loans = await tx.query<BoardCompanyFinance["loans"][number]>(
    `select l.id, l.name, l.lender, l.principal_eur::text, l.balance_eur::text, l.balance_date::text, l.due_on::text,
            (select coalesce(sum(s.remaining_eur), 0)::text from er_loan_shares s where s.loan_id = l.id) as shares_remaining,
            (select count(*)::int from er_loan_shares s where s.loan_id = l.id and s.paid_off_on is not null) as paid_off_count
       from er_loans l where l.company_id = $1 order by l.name`,
    [company.id],
  );
  const runs = await tx.query<BoardCompanyFinance["runs"][number]>(
    "select id, period_start::text, status, totals from er_billing_runs where company_id = $1 order by period_start desc limit 12",
    [company.id],
  );
  const [payment] = await tx.query<{ as_of: string; open_eur: string; overdue_eur: string; overdue_units: number; units: number }>(
    "select as_of::text, open_eur::text, overdue_eur::text, overdue_units, units from er_board_payment_summary($1)",
    [company.id],
  );
  return {
    companyId: company.id,
    companyName: company.name,
    bases: bases.filter((b) => isEffectiveOn(b, today) || b.starts_on > today),
    loans,
    runs,
    payment: payment ?? null,
  };
}
