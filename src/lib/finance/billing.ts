import type { Sql } from "@/lib/db/types";
import { chargesForGroup, type BillableGroup, type ChargeBasisInput, type Period } from "./charges";
import { dueDateFor, fiDate, monthPeriod } from "./dates";
import { financingChargeCents, monthsRemaining } from "./loans";
import { centsToDecimal, toCents } from "./money";
import { primaryPayer, type OwnershipForBilling } from "./payers";
import { assignSequenceNumbers, companyReference } from "./references";
import type { MatchCandidate, MatchedStatus, UnmatchedRow } from "./payment-import";
import { advanceParts, monthlyAdvanceDescription, type WaterAdvance } from "@/lib/water/settlement";

/**
 * Laskutusajon muodostus ja tilasiirtymät. Kaikki funktiot saavat
 * käyttäjän RLS-transaktion, joten toisen organisaation yhtiölle ei synny
 * rivejä, vaikka tunniste arvattaisiin.
 */

export class FinanceError extends Error {}

export interface BillingSettings {
  company_id: string;
  organization_id: string;
  company_number: number;
  due_day: number;
  bank_iban: string | null;
  bank_bic: string | null;
  billing_note: string | null;
}

export async function getBillingSettings(tx: Sql, companyId: string): Promise<BillingSettings | null> {
  const [row] = await tx.query<BillingSettings>(
    "select company_id, organization_id, company_number, due_day, bank_iban, bank_bic, billing_note from er_company_billing_settings where company_id = $1",
    [companyId],
  );
  return row ?? null;
}

/** Osakeryhmien järjestysnumerot; puuttuvat jaetaan ja tallennetaan. */
export async function ensureUnitNumbers(tx: Sql, companyId: string): Promise<Map<string, number>> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
  if (!company) throw new FinanceError("Yhtiötä ei löytynyt.");
  const groups = await tx.query<{ id: string; unit_label: string }>(
    "select id, unit_label from er_share_groups where company_id = $1 and removed_on is null",
    [companyId],
  );
  const existingRows = await tx.query<{ share_group_id: string; seq_no: number }>(
    "select share_group_id, seq_no from er_billing_unit_numbers where company_id = $1",
    [companyId],
  );
  const existing = new Map(existingRows.map((r) => [r.share_group_id, r.seq_no]));
  for (const a of assignSequenceNumbers(groups, existing)) {
    await tx.query("insert into er_billing_unit_numbers (organization_id, company_id, share_group_id, seq_no) values ($1,$2,$3,$4)", [
      company.organization_id, companyId, a.id, a.seqNo,
    ]);
    existing.set(a.id, a.seqNo);
  }
  return existing;
}

export async function loadChargeBases(tx: Sql, companyId: string): Promise<(ChargeBasisInput & { source: string; decided_on: string | null; decision_note: string | null; htj_charge_type: string | null; created_at: string })[]> {
  return tx.query(
    `select id, charge_type, label, basis, unit_price::text, vat_percent::text, applies_to_kinds, starts_on::text, ends_on::text,
            decided_on::text, decision_note, htj_charge_type, source, created_at::text
       from er_charge_bases where company_id = $1
      order by charge_type, starts_on desc`,
    [companyId],
  );
}

export interface GroupForRun extends BillableGroup {
  share_count: number;
}

export async function loadBillableGroups(tx: Sql, companyId: string, onDate: string): Promise<GroupForRun[]> {
  return tx.query<GroupForRun>(
    `select g.id, g.unit_label, g.kind, g.area_m2::text, g.share_count,
            (select count(*)::int from er_residencies r
              where r.share_group_id = g.id and (r.starts_on is null or r.starts_on <= $2::date)
                and (r.ends_on is null or r.ends_on >= $2::date)) as resident_count
       from er_share_groups g
      where g.company_id = $1 and (g.removed_on is null or g.removed_on > $2::date)`,
    [companyId, onDate],
  );
}

interface OwnershipRow extends OwnershipForBilling {
  share_group_id: string;
  accounting_customer_no: string | null;
}

export interface LoanShareForRun {
  loan_id: string;
  loan_name: string;
  due_on: string | null;
  share_group_id: string;
  remaining_eur: string;
}

export interface RunLineDraft {
  shareGroupId: string;
  unitLabel: string;
  payerPartyId: string | null;
  chargeBasisId: string | null;
  loanId: string | null;
  chargeType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amountCents: bigint;
  vatPercent: string;
  referenceNumber: string;
}

export interface RunTotals {
  total_eur: string;
  by_charge_type: Record<string, string>;
  line_count: number;
  group_count: number;
  missing_payer_count: number;
  warnings: string[];
}

/**
 * Laskutusajon rivit (puhdas funktio). Maksaja määräytyy kauden
 * ensimmäisen päivän omistuksista.
 */
export function buildRunLines(input: {
  period: Period;
  companyNumber: number;
  bases: ChargeBasisInput[];
  groups: GroupForRun[];
  unitNumbers: Map<string, number>;
  ownerships: OwnershipRow[];
  loanShares?: LoanShareForRun[];
  /** Vesiennakot (0100): laskutetaan kuukausittain omana rivinään. */
  waterAdvances?: WaterAdvance[];
}): { lines: RunLineDraft[]; totals: RunTotals } {
  const lines: RunLineDraft[] = [];
  const warnings: string[] = [];
  let missingPayer = 0;
  const groups = [...input.groups].sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }));

  for (const g of groups) {
    const seq = input.unitNumbers.get(g.id);
    if (!seq) throw new FinanceError(`Huoneistolta ${g.unit_label} puuttuu viitteen järjestysnumero.`);
    const reference = companyReference(input.companyNumber, seq);
    const payer = primaryPayer(input.ownerships.filter((o) => o.share_group_id === g.id), input.period.start);
    const result = chargesForGroup(input.bases, g, input.period);
    warnings.push(...result.warnings);

    const groupLines: RunLineDraft[] = result.lines.map((l) => ({
      shareGroupId: g.id,
      unitLabel: g.unit_label,
      payerPartyId: payer?.party_id ?? null,
      chargeBasisId: l.chargeBasisId,
      loanId: null,
      chargeType: l.chargeType,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amountCents: l.amountCents,
      vatPercent: l.vatPercent,
      referenceNumber: reference,
    }));

    for (const s of (input.loanShares ?? []).filter((x) => x.share_group_id === g.id && x.due_on)) {
      const remaining = toCents(s.remaining_eur);
      const amount = financingChargeCents(remaining, input.period.start, s.due_on!);
      if (amount === 0n) continue;
      const months = monthsRemaining(input.period.start, s.due_on!);
      groupLines.push({
        shareGroupId: g.id,
        unitLabel: g.unit_label,
        payerPartyId: payer?.party_id ?? null,
        chargeBasisId: null,
        loanId: s.loan_id,
        chargeType: "financing",
        description: `Rahoitusvastike, ${s.loan_name}: lainaosuus ${centsToDecimal(remaining).replace(".", ",")} € / ${months} kk (eräpäivä ${fiDate(s.due_on)})`,
        quantity: "1.0000",
        unitPrice: `${centsToDecimal(amount)}00`,
        amountCents: amount,
        vatPercent: "0.0",
        referenceNumber: reference,
      });
    }

    for (const part of advanceParts(input.waterAdvances ?? [], g.id, input.period)) {
      groupLines.push({
        shareGroupId: g.id,
        unitLabel: g.unit_label,
        payerPartyId: payer?.party_id ?? null,
        chargeBasisId: null,
        loanId: null,
        chargeType: "water_advance",
        description: monthlyAdvanceDescription(part, input.period),
        quantity: "1.0000",
        unitPrice: `${centsToDecimal(part.cents)}00`,
        amountCents: part.cents,
        vatPercent: "0.0",
        referenceNumber: reference,
      });
    }

    if (groupLines.length > 0 && !payer) {
      missingPayer++;
      warnings.push(`${g.unit_label}: omistaja puuttuu, maksaja on tyhjä`);
    }
    lines.push(...groupLines);
  }

  const byType: Record<string, bigint> = {};
  let total = 0n;
  for (const l of lines) {
    byType[l.chargeType] = (byType[l.chargeType] ?? 0n) + l.amountCents;
    total += l.amountCents;
  }
  return {
    lines,
    totals: {
      total_eur: centsToDecimal(total),
      by_charge_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, centsToDecimal(v)])),
      line_count: lines.length,
      group_count: new Set(lines.map((l) => l.shareGroupId)).size,
      missing_payer_count: missingPayer,
      warnings,
    },
  };
}

export async function loadOwnershipsForBilling(tx: Sql, companyId: string): Promise<OwnershipRow[]> {
  return tx.query<OwnershipRow>(
    `select o.share_group_id, o.party_id, p.display_name, o.share_numerator, o.share_denominator,
            o.starts_on::text, o.ends_on::text, p.accounting_customer_no
       from er_ownerships o
       join er_parties p on p.id = o.party_id
       join er_share_groups g on g.id = o.share_group_id
      where g.company_id = $1`,
    [companyId],
  );
}

export async function createBillingRun(
  tx: Sql,
  opts: { companyId: string; month: string; userId: string; includeLoanFinancing?: boolean },
): Promise<{ runId: string; totals: RunTotals }> {
  const settings = await getBillingSettings(tx, opts.companyId);
  if (!settings) throw new FinanceError("Tallenna ensin yhtiön laskutusasetukset (yhtiön numero viitettä varten).");
  const period = monthPeriod(opts.month);

  const [existing] = await tx.query<{ id: string }>(
    "select id from er_billing_runs where company_id = $1 and period_start = $2 and status <> 'cancelled' and kind = 'charges'",
    [opts.companyId, period.start],
  );
  if (existing) throw new FinanceError("Kaudelle on jo laskutusajo. Peru se ensin, jos haluat laskea uudelleen.");

  const unitNumbers = await ensureUnitNumbers(tx, opts.companyId);
  const [bases, groups, ownerships] = await Promise.all([
    loadChargeBases(tx, opts.companyId),
    loadBillableGroups(tx, opts.companyId, period.start),
    loadOwnershipsForBilling(tx, opts.companyId),
  ]);
  const loanShares = opts.includeLoanFinancing
    ? await tx.query<LoanShareForRun>(
        `select l.id as loan_id, l.name as loan_name, l.due_on::text, s.share_group_id, s.remaining_eur::text
           from er_loan_shares s join er_loans l on l.id = s.loan_id
          where l.company_id = $1 and l.allocated and s.paid_off_on is null and s.remaining_eur > 0`,
        [opts.companyId],
      )
    : [];

  const waterAdvances = await tx.query<WaterAdvance>(
    "select share_group_id, monthly_eur::text, starts_on::text, ends_on::text from er_water_advances where company_id = $1",
    [opts.companyId],
  );
  const { lines, totals } = buildRunLines({ period, companyNumber: settings.company_number, bases, groups, unitNumbers, ownerships, loanShares, waterAdvances });
  if (lines.length === 0) throw new FinanceError("Kaudelle ei muodostunut yhtään vastikeriviä. Tarkista vastikeperusteet ja huoneistojen pinta-alat.");

  const [run] = await tx.query<{ id: string }>(
    `insert into er_billing_runs (organization_id, company_id, period_start, period_end, due_on, created_by, totals)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [settings.organization_id, opts.companyId, period.start, period.end, dueDateFor(period.start, settings.due_day), opts.userId, JSON.stringify(totals)],
  );
  for (const [index, l] of lines.entries()) {
    await tx.query(
      `insert into er_billing_lines (organization_id, run_id, share_group_id, payer_party_id, charge_basis_id, loan_id, charge_type,
          description, quantity, unit_price, amount_eur, vat_percent, reference_number, line_no)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [settings.organization_id, run.id, l.shareGroupId, l.payerPartyId, l.chargeBasisId, l.loanId, l.chargeType, l.description,
        l.quantity, l.unitPrice, centsToDecimal(l.amountCents), l.vatPercent, l.referenceNumber, index + 1],
    );
  }
  return { runId: run.id, totals };
}

export async function approveBillingRun(tx: Sql, runId: string, companyId: string, userId: string): Promise<boolean> {
  const rows = await tx.query(
    `update er_billing_runs set status = 'approved', approved_by = $3, approved_at = now()
      where id = $1 and company_id = $2 and status = 'draft' returning id`,
    [runId, companyId, userId],
  );
  return rows.length === 1;
}

export async function cancelBillingRun(tx: Sql, runId: string, companyId: string): Promise<boolean> {
  // Viety ajo on jo kirjanpidossa: sen peruminen tehdään hyvityksenä siellä.
  const rows = await tx.query(
    "update er_billing_runs set status = 'cancelled' where id = $1 and company_id = $2 and status in ('draft', 'approved') returning id",
    [runId, companyId],
  );
  return rows.length === 1;
}

/** Viennin aineisto kirjanpitoadapterille. */
export async function loadRunExport(tx: Sql, runId: string, companyId: string) {
  const [run] = await tx.query<{
    id: string; organization_id: string; status: string; kind: string; period_start: string; period_end: string; due_on: string | null;
    company_name: string; business_id: string; bank_iban: string | null; bank_bic: string | null;
  }>(
    `select r.id, r.organization_id, r.status, r.kind, r.period_start::text, r.period_end::text, r.due_on::text,
            c.name as company_name, c.business_id, s.bank_iban, s.bank_bic
       from er_billing_runs r
       join er_housing_companies c on c.id = r.company_id
       left join er_company_billing_settings s on s.company_id = r.company_id
      where r.id = $1 and r.company_id = $2`,
    [runId, companyId],
  );
  if (!run) return null;
  const lines = await tx.query<{
    unit_label: string; payer_name: string | null; accounting_customer_no: string | null; street_address: string | null;
    postal_code: string | null; city: string | null; charge_type: string; description: string; quantity: string;
    unit_price: string; amount_eur: string; vat_percent: string; reference_number: string;
  }>(
    `select g.unit_label, p.display_name as payer_name, p.accounting_customer_no, p.street_address, p.postal_code, p.city,
            l.charge_type, l.description, l.quantity::text, l.unit_price::text, l.amount_eur::text, l.vat_percent::text, l.reference_number
       from er_billing_lines l
       join er_share_groups g on g.id = l.share_group_id
       left join er_parties p on p.id = l.payer_party_id
      where l.run_id = $1
      order by l.reference_number, l.line_no, l.charge_type, l.description`,
    [runId],
  );
  return { run, lines };
}

export async function markRunExported(tx: Sql, runId: string, companyId: string, documentId: string): Promise<boolean> {
  const rows = await tx.query(
    `update er_billing_runs set status = 'exported', exported_at = now(), export_document_id = $3
      where id = $1 and company_id = $2 and status in ('approved', 'exported') returning id`,
    [runId, companyId, documentId],
  );
  return rows.length === 1;
}

/** Maksutilanteen tallennus. Tiedostosta puuttuvat osakeryhmät saavat nollasaldon samalle päivälle. */
export async function savePaymentImport(
  tx: Sql,
  opts: { companyId: string; fileName: string; asOf: string; rowCount: number; matched: MatchedStatus[]; unmatched: UnmatchedRow[]; userId: string; source?: "csv" | "ppr" },
): Promise<string> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [opts.companyId]);
  if (!company) throw new FinanceError("Yhtiötä ei löytynyt.");
  const [imp] = await tx.query<{ id: string }>(
    `insert into er_payment_imports (organization_id, company_id, file_name, as_of, rows, matched, unmatched, imported_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [company.organization_id, opts.companyId, opts.fileName.slice(0, 200), opts.asOf, opts.rowCount, opts.matched.length, JSON.stringify(opts.unmatched), opts.userId],
  );

  const settings = await getBillingSettings(tx, opts.companyId);
  const numbers = await tx.query<{ share_group_id: string; seq_no: number }>("select share_group_id, seq_no from er_billing_unit_numbers where company_id = $1", [opts.companyId]);
  const refFor = new Map(numbers.map((n) => [n.share_group_id, settings ? companyReference(settings.company_number, n.seq_no) : null]));
  const byGroup = new Map(opts.matched.map((m) => [m.shareGroupId, m]));
  const groups = await tx.query<{ id: string }>("select id from er_share_groups where company_id = $1 and removed_on is null", [opts.companyId]);
  const ownerships = await loadOwnershipsForBilling(tx, opts.companyId);

  for (const g of groups) {
    const m = byGroup.get(g.id);
    const payer = primaryPayer(ownerships.filter((o) => o.share_group_id === g.id), opts.asOf);
    await tx.query(
      `insert into er_payment_status (organization_id, company_id, share_group_id, party_id, reference_number, open_eur, overdue_eur, oldest_due_on, as_of, import_id, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (share_group_id, as_of) do update set party_id = excluded.party_id, reference_number = excluded.reference_number,
         open_eur = excluded.open_eur, overdue_eur = excluded.overdue_eur, oldest_due_on = excluded.oldest_due_on,
         import_id = excluded.import_id, imported_at = now(), source = excluded.source`,
      [company.organization_id, opts.companyId, g.id, payer?.party_id ?? null, m?.reference ?? refFor.get(g.id) ?? null,
        m ? centsToDecimal(m.openCents) : "0.00", m ? centsToDecimal(m.overdueCents) : "0.00", m?.oldestDueOn ?? null, opts.asOf, imp.id, opts.source ?? "csv"],
    );
  }
  return imp.id;
}

/** Kohdistuksen ehdokkaat: yhtiön osakeryhmät viitteineen. */
export async function loadMatchCandidates(tx: Sql, companyId: string): Promise<MatchCandidate[]> {
  const settings = await getBillingSettings(tx, companyId);
  const numbers = settings ? await ensureUnitNumbers(tx, companyId) : new Map<string, number>();
  const groups = await tx.query<{ id: string; unit_label: string }>(
    "select id, unit_label from er_share_groups where company_id = $1 and removed_on is null",
    [companyId],
  );
  return groups.map((g) => ({
    shareGroupId: g.id,
    unitLabel: g.unit_label,
    reference: settings && numbers.has(g.id) ? companyReference(settings.company_number, numbers.get(g.id)!) : null,
  }));
}
