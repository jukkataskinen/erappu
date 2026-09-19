import type { Sql } from "@/lib/db/types";
import { FinanceError } from "./billing";
import { centsToDecimal, toCents } from "./money";
import { recalculateLoanShares } from "./registers";
import {
  chargeStatement,
  fiscalPeriod,
  loanShareStatement,
  type ChargeStatement,
  type ChargeStatementInput,
  type FiscalPeriod,
  type LoanPeriodInput,
  type LoanShareHolder,
  type LoanShareStatement,
} from "./statements";

/**
 * Tilinpäätöksen laskelmien haku ja tallennus (0102). Kutsujan
 * RLS-transaktio. Lainan tilikauden luvut ja jälkilaskelman tuotot tulevat
 * kirjanpidosta; eRappu esitäyttää sen, minkä se tietää (edellisen
 * tilikauden loppusaldo, kertasuoritukset, eRapun laskuttamat
 * rahoitusvastikkeet).
 */

export interface StatementLoan {
  id: string;
  name: string;
  lender: string | null;
  dueOn: string | null;
  allocated: boolean;
  saved: boolean;
  values: LoanPeriodInput;
  note: string | null;
  /** Mistä esitäytetyt arvot tulivat (näytetään lomakkeella). */
  prefill: { opening: string | null; lumpSum: string | null };
  statement: LoanShareStatement | null;
}

export interface StatementData {
  company: { id: string; name: string; businessId: string; organizationId: string; fiscalYearStart: string };
  endYear: number;
  period: FiscalPeriod;
  loans: StatementLoan[];
  charges: ChargeStatementInput & { saved: boolean; note: string | null };
  chargePrefill: { financingIncome: string | null; carriedIn: string | null };
  result: ChargeStatement;
}

const blank = (): LoanPeriodInput => ({ openingBalanceEur: "0", drawnEur: "0", amortizationEur: "0", lumpSumEur: "0", closingBalanceEur: "0", interestEur: "0" });

export async function loadStatementData(tx: Sql, companyId: string, endYear: number): Promise<StatementData | null> {
  const [c] = await tx.query<{ id: string; name: string; business_id: string; organization_id: string; fiscal_year_start: string }>(
    "select id, name, business_id, organization_id, fiscal_year_start from er_housing_companies where id = $1",
    [companyId],
  );
  if (!c) return null;
  const period = fiscalPeriod(c.fiscal_year_start, endYear);

  const loans = await tx.query<{ id: string; name: string; lender: string | null; due_on: string | null; allocated: boolean; principal_eur: string; drawn_on: string | null }>(
    `select id, name, lender, due_on::text, allocated, principal_eur::text, drawn_on::text from er_loans
      where company_id = $1 and (drawn_on is null or drawn_on <= $2::date) order by name`,
    [companyId, period.end],
  );
  const periods = await tx.query<{
    loan_id: string; period_start: string; opening_balance_eur: string; drawn_eur: string; amortization_eur: string; lump_sum_eur: string;
    closing_balance_eur: string; interest_eur: string; note: string | null;
  }>(
    `select loan_id, period_start::text, opening_balance_eur::text, drawn_eur::text, amortization_eur::text, lump_sum_eur::text, closing_balance_eur::text,
            interest_eur::text, note
       from er_loan_periods where company_id = $1 and period_start <= $2::date`,
    [companyId, period.start],
  );
  const groups = await tx.query<{ id: string; unit_label: string; share_count: number }>(
    "select id, unit_label, share_count from er_share_groups where company_id = $1 and (removed_on is null or removed_on > $2::date)",
    [companyId, period.start],
  );
  const shares = await tx.query<{ loan_id: string; share_group_id: string; paid_off_on: string | null; paid_off_eur: string | null }>(
    `select s.loan_id, s.share_group_id, s.paid_off_on::text, s.paid_off_eur::text
       from er_loan_shares s join er_loans l on l.id = s.loan_id where l.company_id = $1`,
    [companyId],
  );

  const out: StatementLoan[] = [];
  for (const l of loans) {
    const current = periods.find((p) => p.loan_id === l.id && p.period_start === period.start);
    const previous = periods.filter((p) => p.loan_id === l.id && p.period_start < period.start).sort((a, b) => b.period_start.localeCompare(a.period_start))[0];
    const own = shares.filter((s) => s.loan_id === l.id);
    const lumpCents = own
      .filter((s) => s.paid_off_on && s.paid_off_on >= period.start && s.paid_off_on <= period.end && s.paid_off_eur)
      .reduce((sum, s) => sum + toCents(s.paid_off_eur!), 0n);
    const prefill = {
      opening: previous ? previous.closing_balance_eur : l.drawn_on && l.drawn_on >= period.start ? "0.00" : null,
      lumpSum: lumpCents > 0n ? centsToDecimal(lumpCents) : null,
    };
    const values: LoanPeriodInput = current
      ? {
          openingBalanceEur: current.opening_balance_eur, drawnEur: current.drawn_eur, amortizationEur: current.amortization_eur, lumpSumEur: current.lump_sum_eur,
          closingBalanceEur: current.closing_balance_eur, interestEur: current.interest_eur,
        }
      : { ...blank(), openingBalanceEur: prefill.opening ?? "0", lumpSumEur: prefill.lumpSum ?? "0" };
    const holders: LoanShareHolder[] = groups.map((g) => {
      const s = own.find((x) => x.share_group_id === g.id);
      return { shareGroupId: g.id, unitLabel: g.unit_label, shareCount: g.share_count, paidOffOn: s?.paid_off_on ?? null, paidOffEur: s?.paid_off_eur ?? null };
    });
    out.push({
      id: l.id, name: l.name, lender: l.lender, dueOn: l.due_on, allocated: l.allocated, saved: Boolean(current), values, note: current?.note ?? null, prefill,
      statement: current && l.allocated ? loanShareStatement(period, values, holders) : null,
    });
  }

  const [row] = await tx.query<{
    maintenance_income_eur: string | null; maintenance_expenses_eur: string | null; financing_income_eur: string | null; interest_from_financing: boolean;
    carried_in_eur: string; note: string | null;
  }>(
    `select maintenance_income_eur::text, maintenance_expenses_eur::text, financing_income_eur::text, interest_from_financing, carried_in_eur::text, note
       from er_charge_statements where company_id = $1 and period_start = $2`,
    [companyId, period.start],
  );
  // Edellisen tilikauden käyttämättömät rahoitusvastikkeet siirtyvät tämän alkuun.
  const [prev] = await tx.query<{ period_start: string; period_end: string; financing_income_eur: string | null; interest_from_financing: boolean; carried_in_eur: string }>(
    `select period_start::text, period_end::text, financing_income_eur::text, interest_from_financing, carried_in_eur::text
       from er_charge_statements where company_id = $1 and period_start < $2 order by period_start desc limit 1`,
    [companyId, period.start],
  );
  let carriedIn: string | null = null;
  if (prev) {
    const prevLoans = periods.filter((p) => p.period_start === prev.period_start);
    const prevResult = chargeStatement(
      { maintenanceIncomeEur: null, maintenanceExpensesEur: null, financingIncomeEur: prev.financing_income_eur, interestFromFinancing: prev.interest_from_financing, carriedInEur: prev.carried_in_eur },
      prevLoans.map((p) => ({ openingBalanceEur: p.opening_balance_eur, drawnEur: p.drawn_eur, amortizationEur: p.amortization_eur, lumpSumEur: p.lump_sum_eur, closingBalanceEur: p.closing_balance_eur, interestEur: p.interest_eur })),
    );
    carriedIn = prevResult.financing ? centsToDecimal(prevResult.financing.carriedOutCents) : null;
  }
  const [billed] = await tx.query<{ total: string | null }>(
    `select sum(l.amount_eur)::text as total
       from er_billing_lines l join er_billing_runs r on r.id = l.run_id
      where r.company_id = $1 and r.status in ('approved', 'exported') and l.charge_type in ('financing', 'capital')
        and r.period_start >= $2::date and r.period_start <= $3::date`,
    [companyId, period.start, period.end],
  );
  const chargePrefill = { financingIncome: billed?.total ?? null, carriedIn };
  const charges = row
    ? {
        maintenanceIncomeEur: row.maintenance_income_eur, maintenanceExpensesEur: row.maintenance_expenses_eur, financingIncomeEur: row.financing_income_eur,
        interestFromFinancing: row.interest_from_financing, carriedInEur: row.carried_in_eur, saved: true, note: row.note,
      }
    : {
        maintenanceIncomeEur: null, maintenanceExpensesEur: null, financingIncomeEur: chargePrefill.financingIncome, interestFromFinancing: true,
        carriedInEur: chargePrefill.carriedIn ?? "0", saved: false, note: null,
      };
  const savedLoans = out.filter((l) => l.saved && l.allocated).map((l) => l.values);
  return {
    company: { id: c.id, name: c.name, businessId: c.business_id, organizationId: c.organization_id, fiscalYearStart: c.fiscal_year_start },
    endYear,
    period,
    loans: out,
    charges,
    chargePrefill,
    result: chargeStatement(charges, savedLoans),
  };
}

export async function saveLoanPeriod(tx: Sql, opts: { companyId: string; loanId: string; endYear: number; values: LoanPeriodInput; note: string | null; userId: string }): Promise<void> {
  const [c] = await tx.query<{ organization_id: string; fiscal_year_start: string }>(
    "select c.organization_id, c.fiscal_year_start from er_housing_companies c join er_loans l on l.company_id = c.id where c.id = $1 and l.id = $2",
    [opts.companyId, opts.loanId],
  );
  if (!c) throw new FinanceError("Lainaa ei löytynyt.");
  const p = fiscalPeriod(c.fiscal_year_start, opts.endYear);
  const v = opts.values;
  await tx.query(
    `insert into er_loan_periods (organization_id, company_id, loan_id, period_start, period_end, opening_balance_eur, drawn_eur, amortization_eur, lump_sum_eur,
        closing_balance_eur, interest_eur, note, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (loan_id, period_start) do update set period_end = excluded.period_end, opening_balance_eur = excluded.opening_balance_eur,
       drawn_eur = excluded.drawn_eur, amortization_eur = excluded.amortization_eur, lump_sum_eur = excluded.lump_sum_eur,
       closing_balance_eur = excluded.closing_balance_eur, interest_eur = excluded.interest_eur, note = excluded.note, updated_by = excluded.updated_by`,
    [c.organization_id, opts.companyId, opts.loanId, p.start, p.end, v.openingBalanceEur, v.drawnEur, v.amortizationEur, v.lumpSumEur, v.closingBalanceEur,
      v.interestEur, opts.note, opts.userId],
  );
}

export async function saveChargeStatement(tx: Sql, opts: { companyId: string; endYear: number; values: ChargeStatementInput; note: string | null; userId: string }): Promise<void> {
  const [c] = await tx.query<{ organization_id: string; fiscal_year_start: string }>(
    "select organization_id, fiscal_year_start from er_housing_companies where id = $1",
    [opts.companyId],
  );
  if (!c) throw new FinanceError("Yhtiötä ei löytynyt.");
  const p = fiscalPeriod(c.fiscal_year_start, opts.endYear);
  const v = opts.values;
  await tx.query(
    `insert into er_charge_statements (organization_id, company_id, period_start, period_end, maintenance_income_eur, maintenance_expenses_eur, financing_income_eur,
        interest_from_financing, carried_in_eur, note, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (company_id, period_start) do update set period_end = excluded.period_end, maintenance_income_eur = excluded.maintenance_income_eur,
       maintenance_expenses_eur = excluded.maintenance_expenses_eur, financing_income_eur = excluded.financing_income_eur,
       interest_from_financing = excluded.interest_from_financing, carried_in_eur = excluded.carried_in_eur, note = excluded.note, updated_by = excluded.updated_by`,
    [c.organization_id, opts.companyId, p.start, p.end, v.maintenanceIncomeEur, v.maintenanceExpensesEur, v.financingIncomeEur, v.interestFromFinancing,
      v.carriedInEur, opts.note, opts.userId],
  );
}

/**
 * Vie tilikauden loppusaldot lainoille ja laskee lainaosuudet uudelleen
 * (isännöitsijäntodistus ja portaali). Uudempaa saldoa ei korvata.
 */
export async function applyClosingBalances(tx: Sql, opts: { companyId: string; endYear: number; today: string }): Promise<number> {
  const data = await loadStatementData(tx, opts.companyId, opts.endYear);
  if (!data) throw new FinanceError("Yhtiötä ei löytynyt.");
  let count = 0;
  for (const l of data.loans.filter((x) => x.saved)) {
    const rows = await tx.query(
      `update er_loans set balance_eur = $3, balance_date = $4
        where id = $1 and company_id = $2 and (balance_date is null or balance_date <= $4::date) returning id`,
      [l.id, opts.companyId, l.values.closingBalanceEur, data.period.end],
    );
    if (rows.length === 0) continue;
    if (l.allocated) await recalculateLoanShares(tx, l.id, opts.companyId, opts.today);
    count++;
  }
  return count;
}
