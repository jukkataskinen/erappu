"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db";
import { emptyToNull, fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { isValidIban } from "@/lib/validation/finnish";
import { getAccountingAdapter } from "@/lib/finance/accounting";
import {
  approveBillingRun,
  cancelBillingRun,
  createBillingRun,
  FinanceError,
  loadMatchCandidates,
  loadRunExport,
  markRunExported,
  savePaymentImport,
} from "@/lib/finance/billing";
import { isIsoDate } from "@/lib/finance/dates";
import { CHARGE_TYPE_TO_HTJ } from "@/lib/finance/labels";
import { matchPaymentRows } from "@/lib/finance/payment-import";
import { addChargeBasis, recalculateLoanShares } from "@/lib/finance/registers";

const uuid = z.string().uuid();
const date = z.string().refine(isIsoDate, "Anna päivämäärä.");
const optDate = z.preprocess(emptyToNull, date.nullable());
const optText = z.preprocess(emptyToNull, z.string().max(500).nullable());
const decimal = (scale: number, message: string) =>
  z
    .string()
    .transform((v) => v.replace(/[\s ]/g, "").replace(",", "."))
    .refine((v) => new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`).test(v), message);
const optDecimal = (scale: number, message: string) => z.preprocess(emptyToNull, decimal(scale, message).nullable());
const checkbox = z.preprocess((v) => v === "on", z.boolean());

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Talouden toimenpiteet: kaikki henkilökunnan roolit, myös kirjanpitäjä. */
async function financeWriter(companyId: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant", "accountant")) fail(`/taloyhtiot/${companyId}/talous`, "Roolillasi ei voi muokata talouden tietoja.");
  return ctx;
}

function base(companyId: string) {
  return `/taloyhtiot/${companyId}/talous`;
}

function handle(err: unknown, back: string): never {
  if (err instanceof FinanceError) fail(back, err.message);
  throw err;
}

async function orgOf(ctx: StaffContext, companyId: string): Promise<string> {
  const [row] = await ctx.run((tx) => tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]));
  if (!row) fail("/talous", "Yhtiötä ei löytynyt.");
  return row.organization_id;
}

// ---------------------------------------------------------------------------
// Laskutusasetukset
// ---------------------------------------------------------------------------
const settingsSchema = z.object({
  company_number: z.coerce.number().int("Yhtiön numero on kokonaisluku.").min(1, "Anna yhtiön numero.").max(999_999_999),
  due_day: z.coerce.number().int().min(1, "Eräpäivä on 1–28.").max(28, "Eräpäivä on 1–28."),
  bank_iban: z.preprocess(
    (v) => (typeof v === "string" ? emptyToNull(v.replace(/\s/g, "").toUpperCase()) : v),
    z.string().refine(isValidIban, "IBAN ei ole kelvollinen.").nullable(),
  ),
  bank_bic: z.preprocess((v) => (typeof v === "string" ? emptyToNull(v.toUpperCase()) : v), z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "BIC on 8 tai 11 merkkiä.").nullable()),
  billing_note: optText,
});

export async function saveBillingSettings(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = base(companyId);
  const ctx = await financeWriter(companyId);
  const d = parseForm(settingsSchema, formData, back);
  const org = await orgOf(ctx, companyId);
  try {
    await ctx.run(async (tx) => {
      await tx.query(
        `insert into er_company_billing_settings (organization_id, company_id, company_number, due_day, bank_iban, bank_bic, billing_note)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (company_id) do update set company_number = excluded.company_number, due_day = excluded.due_day,
           bank_iban = excluded.bank_iban, bank_bic = excluded.bank_bic, billing_note = excluded.billing_note`,
        [org, companyId, d.company_number, d.due_day, d.bank_iban, d.bank_bic, d.billing_note],
      );
      await audit(tx, { organizationId: org, userId: ctx.user.id, action: "update", entity: "billing_settings", entityId: companyId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Yhtiön numero on jo toisen yhtiön käytössä. Viitteiden pitää olla yksilöllisiä.");
    throw err;
  }
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Vastikeperusteet
// ---------------------------------------------------------------------------
const basisSchema = z.object({
  charge_type: z.enum(["maintenance", "land", "heating", "capital", "financing", "water", "sauna", "parking", "other"]),
  label: optText,
  basis: z.enum(["area_m2", "share", "unit", "person", "meter", "fixed"]),
  unit_price: decimal(4, "Yksikköhinta on luku, enintään neljä desimaalia."),
  vat_percent: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), decimal(1, "ALV-prosentti on luku.")),
  starts_on: date,
  decided_on: optDate,
  decision_note: optText,
});

export async function addBasis(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = base(companyId);
  const ctx = await financeWriter(companyId);
  const d = parseForm(basisSchema, formData, back);
  const kinds = formData.getAll("applies_to_kinds").filter((k): k is string => typeof k === "string" && /^(apartment|commercial|parking|garage|storage|other)$/.test(k));
  try {
    await ctx.run(async (tx) => {
      const r = await addChargeBasis(tx, {
        companyId, chargeType: d.charge_type, label: d.label, basis: d.basis, unitPrice: d.unit_price, vatPercent: d.vat_percent,
        appliesToKinds: kinds.length ? kinds : null, startsOn: d.starts_on, decidedOn: d.decided_on, decisionNote: d.decision_note,
        htjChargeType: CHARGE_TYPE_TO_HTJ[d.charge_type] ?? null,
      });
      await audit(tx, { organizationId: await orgOfTx(tx, companyId), userId: ctx.user.id, action: "create", entity: "charge_basis", entityId: r.id, details: { ended: r.ended } });
    });
  } catch (err) {
    handle(err, back);
  }
  revalidatePath(back);
  redirect(back);
}

async function orgOfTx(tx: Sql, companyId: string): Promise<string> {
  const [row] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
  return row.organization_id;
}

// ---------------------------------------------------------------------------
// Lainat ja lainaosuudet
// ---------------------------------------------------------------------------
const loanSchema = z.object({
  name: z.string().min(2, "Anna lainan nimi.").max(200),
  lender: optText,
  principal_eur: decimal(2, "Lainan määrä on euroina, enintään kaksi desimaalia."),
  undrawn_eur: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), decimal(2, "Nostamaton määrä on euroina.")),
  balance_eur: optDecimal(2, "Saldo on euroina, enintään kaksi desimaalia."),
  balance_date: optDate,
  drawn_on: optDate,
  due_on: optDate,
  interest_terms: optText,
  purpose: optText,
  allocated: checkbox,
});

export async function saveLoan(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const loanId = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const back = loanId ? `${base(companyId)}/lainat/${loanId}` : base(companyId);
  const ctx = await financeWriter(companyId);
  const d = parseForm(loanSchema, formData, back);
  if (d.balance_eur !== null && !d.balance_date) fail(back, "Anna saldon päivämäärä.");
  const org = await orgOf(ctx, companyId);
  const id = await ctx.run(async (tx) => {
    const values = [d.name, d.lender, d.principal_eur, d.undrawn_eur, d.balance_eur, d.balance_date, d.drawn_on, d.due_on, d.interest_terms, d.purpose, d.allocated];
    let rowId = loanId;
    if (rowId) {
      const r = await tx.query(
        `update er_loans set name=$3, lender=$4, principal_eur=$5, undrawn_eur=$6, balance_eur=$7, balance_date=$8, drawn_on=$9, due_on=$10,
            interest_terms=$11, purpose=$12, allocated=$13
          where id = $1 and company_id = $2 and source <> 'htj' returning id`,
        [rowId, companyId, ...values],
      );
      if (r.length === 0) fail(back, "HTJ:stä tulleita lainoja ei muokata käsin.");
    } else {
      const [row] = await tx.query<{ id: string }>(
        `insert into er_loans (organization_id, company_id, name, lender, principal_eur, undrawn_eur, balance_eur, balance_date, drawn_on, due_on,
            interest_terms, purpose, allocated)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [org, companyId, ...values],
      );
      rowId = row.id;
    }
    await audit(tx, { organizationId: org, userId: ctx.user.id, action: loanId ? "update" : "create", entity: "loan", entityId: rowId });
    return rowId!;
  });
  revalidatePath(base(companyId));
  redirect(`${base(companyId)}/lainat/${id}`);
}

export async function recalcLoanShares(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const loanId = uuid.parse(formData.get("loan_id"));
  const back = `${base(companyId)}/lainat/${loanId}`;
  const ctx = await financeWriter(companyId);
  try {
    await ctx.run(async (tx) => {
      const count = await recalculateLoanShares(tx, loanId, companyId, isoDateHelsinki());
      await audit(tx, { organizationId: await orgOfTx(tx, companyId), userId: ctx.user.id, action: "recalculate", entity: "loan_shares", entityId: loanId, details: { count } });
    });
  } catch (err) {
    handle(err, back);
  }
  revalidatePath(back);
  redirect(back);
}

const loanShareSchema = z.object({
  original_eur: decimal(2, "Alkuperäinen osuus on euroina."),
  remaining_eur: decimal(2, "Jäljellä oleva osuus on euroina."),
  balance_date: date,
  paid_off_on: optDate,
});

export async function updateLoanShare(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const loanId = uuid.parse(formData.get("loan_id"));
  const shareId = uuid.parse(formData.get("id"));
  const back = `${base(companyId)}/lainat/${loanId}`;
  const ctx = await financeWriter(companyId);
  const d = parseForm(loanShareSchema, formData, back);
  // Kertasuorituksen jälkeen osuutta ei ole jäljellä.
  const remaining = d.paid_off_on ? "0" : d.remaining_eur;
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      `update er_loan_shares s set original_eur = $3, remaining_eur = $4, balance_date = $5, paid_off_on = $6
         from er_loans l
        where s.id = $1 and s.loan_id = $2 and l.id = s.loan_id and l.company_id = $7
        returning s.organization_id`,
      [shareId, loanId, d.original_eur, remaining, d.paid_off_on ? d.paid_off_on : d.balance_date, d.paid_off_on, companyId],
    );
    if (rows.length === 0) fail(back, "Lainaosuutta ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: d.paid_off_on ? "paid_off" : "update", entity: "loan_share", entityId: shareId });
  });
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Laskutusajot
// ---------------------------------------------------------------------------
export async function createRun(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = base(companyId);
  const ctx = await financeWriter(companyId);
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(formData.get("month"));
  if (!month.success) fail(back, "Valitse laskutuskuukausi.");
  let runId = "";
  try {
    runId = await ctx.run(async (tx) => {
      const r = await createBillingRun(tx, { companyId, month: month.data, userId: ctx.user.id, includeLoanFinancing: formData.get("loan_financing") === "on" });
      await audit(tx, { organizationId: await orgOfTx(tx, companyId), userId: ctx.user.id, action: "create", entity: "billing_run", entityId: r.runId, details: { month: month.data, lines: r.totals.line_count } });
      return r.runId;
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Kaudelle on jo laskutusajo.");
    handle(err, back);
  }
  revalidatePath(back);
  redirect(`${back}/ajot/${runId}`);
}

async function runAction(formData: FormData, kind: "approve" | "cancel") {
  const companyId = uuid.parse(formData.get("company_id"));
  const runId = uuid.parse(formData.get("run_id"));
  const back = `${base(companyId)}/ajot/${runId}`;
  const ctx = await financeWriter(companyId);
  if (kind === "approve" && !ctx.can("owner", "manager", "accountant")) fail(back, "Laskutusajon hyväksyy isännöitsijä tai kirjanpitäjä.");
  await ctx.run(async (tx) => {
    const ok = kind === "approve" ? await approveBillingRun(tx, runId, companyId, ctx.user.id) : await cancelBillingRun(tx, runId, companyId);
    if (!ok) fail(back, kind === "approve" ? "Vain luonnoksen voi hyväksyä." : "Kirjanpitoon viety ajo korjataan hyvityksellä kirjanpidossa.");
    await audit(tx, { organizationId: await orgOfTx(tx, companyId), userId: ctx.user.id, action: kind, entity: "billing_run", entityId: runId });
  });
  revalidatePath(base(companyId));
  revalidatePath(back);
  redirect(back);
}

export async function approveRun(formData: FormData) {
  return runAction(formData, "approve");
}

export async function cancelRun(formData: FormData) {
  return runAction(formData, "cancel");
}

/**
 * Vienti kirjanpitoon. CSV tallennetaan dokumenttina (sisäinen näkyvyys),
 * jotta vienti on jäljitettävissä ja ladattavissa uudelleen samana.
 */
export async function exportRun(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const runId = uuid.parse(formData.get("run_id"));
  const back = `${base(companyId)}/ajot/${runId}`;
  const ctx = await financeWriter(companyId);
  const data = await ctx.run((tx) => loadRunExport(tx, runId, companyId));
  if (!data) fail(base(companyId), "Laskutusajoa ei löytynyt.");
  if (data.run.status !== "approved" && data.run.status !== "exported") fail(back, "Hyväksy laskutusajo ennen vientiä.");

  const adapter = getAccountingAdapter();
  const file = await adapter.exportBillingRun({
    runId: data.run.id,
    companyName: data.run.company_name,
    businessId: data.run.business_id,
    periodStart: data.run.period_start,
    periodEnd: data.run.period_end,
    dueOn: data.run.due_on,
    iban: data.run.bank_iban,
    bic: data.run.bank_bic,
    lines: data.lines.map((l) => ({
      unitLabel: l.unit_label, payerName: l.payer_name, payerCustomerNo: l.accounting_customer_no, payerStreet: l.street_address,
      payerPostalCode: l.postal_code, payerCity: l.city, chargeType: l.charge_type, description: l.description, quantity: l.quantity,
      unitPrice: l.unit_price, amountEur: l.amount_eur, vatPercent: l.vat_percent, referenceNumber: l.reference_number,
    })),
  });
  const stored = await storeFile({ organizationId: data.run.organization_id, companyId, fileName: file.fileName, mimeType: file.mimeType, bytes: file.content });
  try {
    await ctx.run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility,
            year, subject_table, subject_id, uploaded_by)
         values ($1,$2,'other',$3,$4,$5,$6,$7,$8,'internal',$9,'er_billing_runs',$10,$11) returning id`,
        [data.run.organization_id, companyId, `Vastikelaskutus ${data.run.period_start.slice(5, 7)}/${data.run.period_start.slice(0, 4)} (kirjanpitoon)`,
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, Number(data.run.period_start.slice(0, 4)), runId, ctx.user.id],
      );
      if (!(await markRunExported(tx, runId, companyId, doc.id))) throw new FinanceError("Laskutusajon tila muuttui. Yritä uudelleen.");
      await audit(tx, { organizationId: data.run.organization_id, userId: ctx.user.id, action: "export", entity: "billing_run", entityId: runId, details: { adapter: adapter.name, document_id: doc.id } });
    });
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    handle(err, back);
  }
  revalidatePath(base(companyId));
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Maksutilanteen tuonti
// ---------------------------------------------------------------------------
export async function importPayments(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = base(companyId);
  const ctx = await financeWriter(companyId);
  const asOf = date.safeParse(formData.get("as_of"));
  if (!asOf.success) fail(back, "Anna päivä, jolta maksutilanne on.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail(back, "Valitse CSV-tiedosto.");
  if (file.size > MAX_IMPORT_BYTES) fail(back, "Tiedosto on liian suuri (enintään 2 Mt).");
  if (!/\.(csv|txt)$/i.test(file.name)) fail(back, "Tuo maksutilanne CSV-tiedostona.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.subarray(0, 4).some((b) => b === 0)) fail(back, "Tiedosto ei ole tekstimuotoinen CSV.");
  const parsed = await getAccountingAdapter().importPaymentStatus({ fileName: file.name, bytes });
  if (parsed.errors.length) fail(back, `${parsed.errors[0]}${parsed.errors.length > 1 ? ` (ja ${parsed.errors.length - 1} muuta virhettä)` : ""}`);
  if (parsed.rows.length === 0) fail(back, "Tiedostossa ei ole maksutilanteen rivejä.");

  let importId = "";
  try {
    importId = await ctx.run(async (tx) => {
      const { matched, unmatched } = matchPaymentRows(parsed.rows, await loadMatchCandidates(tx, companyId));
      const id = await savePaymentImport(tx, { companyId, fileName: file.name, asOf: asOf.data, rowCount: parsed.rows.length, matched, unmatched, userId: ctx.user.id });
      await audit(tx, { organizationId: await orgOfTx(tx, companyId), userId: ctx.user.id, action: "import", entity: "payment_status", entityId: id, details: { rows: parsed.rows.length, matched: matched.length, unmatched: unmatched.length } });
      return id;
    });
  } catch (err) {
    handle(err, back);
  }
  revalidatePath(back);
  redirect(`${back}/tuonnit/${importId}`);
}
