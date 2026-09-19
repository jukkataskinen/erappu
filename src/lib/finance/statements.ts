import { addDays } from "./dates";
import { allocateByShares } from "./loans";
import { centsToDecimal, toCents } from "./money";
import { compareUnitLabels } from "./references";

/**
 * Tilinpäätöksen laskelmat (puhtaat funktiot): lainaosuuslaskelma
 * osakeryhmittäin ja rahoitusvastikkeiden jälkilaskelma (AOYL 10:5 §:n
 * 1 kohta, tiedot yhtiövastikkeen käytöstä).
 *
 * Lainan tilikauden luvut tulevat pankin saldotodistuksesta ja
 * kirjanpidosta. Osakeryhmän osuus tilikauden alussa ja lopussa jaetaan
 * osakkeiden suhteessa niille, jotka eivät ole maksaneet osuuttaan
 * kertasuorituksena; lyhennys on näiden erotus, joten rivit summautuvat
 * täsmälleen lainan saldoihin.
 */

export interface FiscalPeriod {
  start: string;
  end: string;
}

/** Tilikausi, joka päättyy vuonna `endYear`. `fiscalYearStart` muodossa "KK-PP". */
export function fiscalPeriod(fiscalYearStart: string, endYear: number): FiscalPeriod {
  const mmdd = /^\d{2}-\d{2}$/.test(fiscalYearStart) ? fiscalYearStart : "01-01";
  if (mmdd === "01-01") return { start: `${endYear}-01-01`, end: `${endYear}-12-31` };
  return { start: `${endYear - 1}-${mmdd}`, end: addDays(`${endYear}-${mmdd}`, -1) };
}

export interface LoanPeriodInput {
  openingBalanceEur: string;
  drawnEur: string;
  amortizationEur: string;
  lumpSumEur: string;
  closingBalanceEur: string;
  interestEur: string;
}

export interface LoanShareHolder {
  shareGroupId: string;
  unitLabel: string;
  shareCount: number;
  paidOffOn: string | null;
  paidOffEur: string | null;
}

export interface LoanShareRow {
  shareGroupId: string;
  unitLabel: string;
  shareCount: number;
  openingCents: bigint;
  lumpSumCents: bigint;
  /** Lyhennys (negatiivinen = nosto kasvatti osuutta). */
  amortizationCents: bigint;
  closingCents: bigint;
  /** Kertasuoritus tilikaudella tai aiemmin. */
  paidOffOn: string | null;
  paidBefore: boolean;
  /** Kertasuorituksen määrä puuttuu; käytetty osuutta tilikauden alussa. */
  lumpSumEstimated: boolean;
}

export interface LoanShareStatement {
  rows: LoanShareRow[];
  totals: { openingCents: bigint; lumpSumCents: bigint; amortizationCents: bigint; closingCents: bigint };
  warnings: string[];
}

const eur = (cents: bigint) => centsToDecimal(cents).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(/^-/, "−");

/** Tilikauden lainaosuuslaskelma yhdelle lainalle. */
export function loanShareStatement(period: FiscalPeriod, loan: LoanPeriodInput, holders: LoanShareHolder[]): LoanShareStatement {
  const warnings: string[] = [];
  const eligible = holders.filter((h) => h.shareCount > 0);
  const paidBefore = (h: LoanShareHolder) => h.paidOffOn !== null && h.paidOffOn < period.start;
  const paidDuring = (h: LoanShareHolder) => h.paidOffOn !== null && h.paidOffOn >= period.start && h.paidOffOn <= period.end;
  const atStart = eligible.filter((h) => !paidBefore(h));
  const atEnd = atStart.filter((h) => !paidDuring(h));
  const toHolding = (h: LoanShareHolder) => ({ id: h.shareGroupId, unit_label: h.unitLabel, share_count: h.shareCount });

  const opening = allocateByShares(toCents(loan.openingBalanceEur), atStart.map(toHolding));
  const closing = allocateByShares(toCents(loan.closingBalanceEur), atEnd.map(toHolding));

  const rows: LoanShareRow[] = [];
  for (const h of eligible) {
    if (paidBefore(h)) {
      rows.push({
        shareGroupId: h.shareGroupId, unitLabel: h.unitLabel, shareCount: h.shareCount, openingCents: 0n, lumpSumCents: 0n, amortizationCents: 0n, closingCents: 0n,
        paidOffOn: h.paidOffOn, paidBefore: true, lumpSumEstimated: false,
      });
      continue;
    }
    const open = opening.get(h.shareGroupId) ?? 0n;
    const close = closing.get(h.shareGroupId) ?? 0n;
    let lump = 0n;
    let estimated = false;
    if (paidDuring(h)) {
      if (h.paidOffEur !== null) lump = toCents(h.paidOffEur);
      else {
        lump = open;
        estimated = true;
      }
    }
    rows.push({
      shareGroupId: h.shareGroupId, unitLabel: h.unitLabel, shareCount: h.shareCount, openingCents: open, lumpSumCents: lump, amortizationCents: open - lump - close, closingCents: close,
      paidOffOn: h.paidOffOn, paidBefore: false, lumpSumEstimated: estimated,
    });
  }
  rows.sort((a, b) => compareUnitLabels(a.unitLabel, b.unitLabel));

  const totals = {
    openingCents: rows.reduce((s, r) => s + r.openingCents, 0n),
    lumpSumCents: rows.reduce((s, r) => s + r.lumpSumCents, 0n),
    amortizationCents: rows.reduce((s, r) => s + r.amortizationCents, 0n),
    closingCents: rows.reduce((s, r) => s + r.closingCents, 0n),
  };

  const expectedClosing = toCents(loan.openingBalanceEur) + toCents(loan.drawnEur) - toCents(loan.amortizationEur) - toCents(loan.lumpSumEur);
  if (expectedClosing !== toCents(loan.closingBalanceEur)) {
    warnings.push(
      `Saldot eivät täsmää: alkusaldo + nostot − lyhennykset − kertasuoritukset = ${eur(expectedClosing)} €, loppusaldo ${eur(toCents(loan.closingBalanceEur))} €.`,
    );
  }
  if (totals.lumpSumCents !== toCents(loan.lumpSumEur)) {
    warnings.push(`Huoneistojen kertasuoritukset yhteensä ${eur(totals.lumpSumCents)} €, lainalle kirjattu ${eur(toCents(loan.lumpSumEur))} €.`);
  }
  const estimated = rows.filter((r) => r.lumpSumEstimated);
  if (estimated.length) warnings.push(`Kertasuorituksen määrä puuttuu (${estimated.map((r) => r.unitLabel).join(", ")}); laskelmassa käytetty osuutta tilikauden alussa.`);
  if (atStart.length === 0 && toCents(loan.openingBalanceEur) > 0n) warnings.push("Lainalla ei ole osakeryhmiä, joille osuudet jaetaan.");
  return { rows, totals, warnings };
}

// ---------------------------------------------------------------------------
// Jälkilaskelma
// ---------------------------------------------------------------------------

export interface ChargeStatementInput {
  maintenanceIncomeEur: string | null;
  maintenanceExpensesEur: string | null;
  financingIncomeEur: string | null;
  interestFromFinancing: boolean;
  carriedInEur: string;
}

export interface ChargeStatement {
  maintenance: { incomeCents: bigint; expensesCents: bigint; resultCents: bigint } | null;
  financing: {
    incomeCents: bigint;
    lumpSumCents: bigint;
    amortizationCents: bigint;
    lumpSumUsedCents: bigint;
    interestCents: bigint;
    resultCents: bigint;
    carriedInCents: bigint;
    carriedOutCents: bigint;
  } | null;
}

/**
 * Hoidon ja rahoituksen jälkilaskelma. Rahoitusvastikkeilla ja
 * kertasuorituksilla katetaan lainojen lyhennykset (ja korot, jos yhtiö on
 * päättänyt periä korot rahoitusvastikkeella). Ylijäämä on käyttämätöntä
 * rahoitusvastiketta, joka siirtyy seuraavalle tilikaudelle.
 */
export function chargeStatement(input: ChargeStatementInput, loans: LoanPeriodInput[]): ChargeStatement {
  const maintenance =
    input.maintenanceIncomeEur !== null && input.maintenanceExpensesEur !== null
      ? (() => {
          const income = toCents(input.maintenanceIncomeEur);
          const expenses = toCents(input.maintenanceExpensesEur);
          return { incomeCents: income, expensesCents: expenses, resultCents: income - expenses };
        })()
      : null;
  if (input.financingIncomeEur === null && loans.length === 0) return { maintenance, financing: null };
  const income = toCents(input.financingIncomeEur ?? "0");
  const lump = loans.reduce((s, l) => s + toCents(l.lumpSumEur), 0n);
  const amortization = loans.reduce((s, l) => s + toCents(l.amortizationEur), 0n);
  const interest = input.interestFromFinancing ? loans.reduce((s, l) => s + toCents(l.interestEur), 0n) : 0n;
  // Kertasuoritukset käytetään kokonaan lainaosuuksiin, joten ne eivät vaikuta yli- tai alijäämään.
  const result = income - amortization - interest;
  const carriedIn = toCents(input.carriedInEur);
  return {
    maintenance,
    financing: {
      incomeCents: income,
      lumpSumCents: lump,
      amortizationCents: amortization,
      lumpSumUsedCents: lump,
      interestCents: interest,
      resultCents: result,
      carriedInCents: carriedIn,
      carriedOutCents: carriedIn + result,
    },
  };
}

/** Toimintakertomuksen teksti vastikkeen käytöstä (AOYL 10:5 §:n 1 kohta). */
export function chargeUsageText(s: ChargeStatement, period: FiscalPeriod): string[] {
  const out: string[] = [];
  const fmt = (c: bigint) => `${eur(c < 0n ? -c : c)} €`;
  if (s.maintenance) {
    const r = s.maintenance.resultCents;
    out.push(
      `Hoitovastikkeilla ja muilla hoitotuotoilla (${fmt(s.maintenance.incomeCents)}) katettiin yhtiön hoitokulut (${fmt(s.maintenance.expensesCents)}). Hoitolaskelma osoittaa ${r >= 0n ? "ylijäämää" : "alijäämää"} ${fmt(r)}.`,
    );
  }
  if (s.financing) {
    const f = s.financing;
    const parts = [`Rahoitusvastikkeita kertyi ${fmt(f.incomeCents)}`];
    if (f.lumpSumCents > 0n) parts.push(`lainaosuuksien kertasuorituksia ${fmt(f.lumpSumCents)}`);
    const used = [`lainojen lyhennyksiin ${fmt(f.amortizationCents)}`];
    if (f.lumpSumUsedCents > 0n) used.push(`kertasuorituksilla maksettuihin lainaosuuksiin ${fmt(f.lumpSumUsedCents)}`);
    if (f.interestCents > 0n) used.push(`lainojen korkoihin ${fmt(f.interestCents)}`);
    out.push(`${parts.join(" ja ")}. Varoja käytettiin ${used.join(", ")}.`);
    out.push(
      f.carriedOutCents >= 0n
        ? `Käyttämättömiä rahoitusvastikkeita on ${formatFi(period.end)} yhteensä ${fmt(f.carriedOutCents)}${f.carriedInCents !== 0n ? `, josta edellisiltä tilikausilta siirtyneitä ${fmt(f.carriedInCents)}` : ""}.`
        : `Rahoitusvastikkeet eivät riittäneet lainojen hoitoon; vaje ${formatFi(period.end)} on ${fmt(f.carriedOutCents)}.`,
    );
  }
  return out;
}

function formatFi(iso: string): string {
  return `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
}

export const centsToEur = eur;
