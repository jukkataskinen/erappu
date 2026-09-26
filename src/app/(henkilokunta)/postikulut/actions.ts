"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { getFennoaClient, isFennoaError } from "@/lib/fennoa";
import { createBillingRun, deleteBillingRun, exportBillingRun, releaseStuckInvoice, saveBillingProfile } from "@/lib/letters/billing";
import { LetterError } from "@/lib/letters/jobs";
import { INVOICE_CHANNELS } from "@/lib/letters/pricing";
import { isValidPostalCode } from "@/lib/validation/finnish";

/**
 * Postikulujen laskutus (Jukka 26.9.2026). Pääkäyttäjä, isännöitsijä ja
 * kirjanpitäjä; kanta rajaa samat roolit (0121).
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna päivämäärä.");

async function biller(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "accountant")) fail(back, "Postikulut laskuttaa pääkäyttäjä, isännöitsijä tai kirjanpitäjä.");
  return ctx;
}

function handle(back: string, err: unknown): never {
  if (err instanceof LetterError || isFennoaError(err)) fail(back, err.message);
  throw err;
}

const runSchema = z
  .object({ period_start: isoDate, period_end: isoDate, invoice_date: isoDate, due_date: isoDate })
  .refine((v) => v.period_end >= v.period_start, "Jakson loppu on ennen alkua.")
  .refine((v) => v.due_date >= v.invoice_date, "Eräpäivä on ennen laskun päivää.");

export async function createBillingRunAction(formData: FormData) {
  const back = "/postikulut";
  const ctx = await biller(back);
  const data = parseForm(runSchema, formData, back);
  let runId: string;
  try {
    runId = await createBillingRun(ctx.run, {
      organizationId: ctx.org.organizationId, userId: ctx.user.id,
      periodStart: data.period_start, periodEnd: data.period_end, invoiceDate: data.invoice_date, dueDate: data.due_date,
    });
  } catch (err) {
    handle(back, err);
  }
  revalidatePath(back);
  redirect(`/postikulut/ajo/${runId}`);
}

function runBack(formData: FormData) {
  const id = uuid.safeParse(formData.get("run_id"));
  if (!id.success) redirect("/postikulut");
  return { runId: id.data, back: `/postikulut/ajo/${id.data}` };
}

export async function exportBillingRunAction(formData: FormData) {
  const { runId, back } = runBack(formData);
  const ctx = await biller(back);
  let result: { exported: number; failed: number; skipped: number };
  try {
    result = await exportBillingRun(ctx.run, getFennoaClient(), { userId: ctx.user.id, runId });
  } catch (err) {
    handle(back, err);
  }
  revalidatePath(back);
  redirect(`${back}?viety=${result.exported}&epaonnistui=${result.failed + result.skipped}`);
}

export async function deleteBillingRunAction(formData: FormData) {
  const { runId, back } = runBack(formData);
  const ctx = await biller(back);
  try {
    await deleteBillingRun(ctx.run, { userId: ctx.user.id, runId });
  } catch (err) {
    handle(back, err);
  }
  revalidatePath("/postikulut");
  redirect("/postikulut");
}

export async function releaseStuckInvoiceAction(formData: FormData) {
  const { back } = runBack(formData);
  const invoiceId = uuid.safeParse(formData.get("invoice_id"));
  if (!invoiceId.success) fail(back, "Laskua ei löytynyt.");
  const ctx = await biller(back);
  try {
    await releaseStuckInvoice(ctx.run, { userId: ctx.user.id, invoiceId: invoiceId.data });
  } catch (err) {
    handle(back, err);
  }
  revalidatePath(back);
  redirect(back);
}

const optText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const profileSchema = z.object({
  fennoa_customer_no: optText(50),
  invoice_channel: z.preprocess(emptyToNull, z.enum(INVOICE_CHANNELS).nullable()),
  einvoice_address: optText(40),
  einvoice_operator: optText(40),
  email: z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200).nullable()),
  street_address: optText(200),
  postal_code: z.preprocess(emptyToNull, z.string().refine(isValidPostalCode, "Postinumerossa on 5 numeroa.").nullable()),
  city: optText(100),
});

export async function saveBillingProfileAction(formData: FormData) {
  const companyId = uuid.safeParse(formData.get("company_id"));
  if (!companyId.success) redirect("/postikulut");
  const back = `/postikulut/yhtio/${companyId.data}`;
  const ctx = await biller(back);
  const data = parseForm(profileSchema, formData, back);
  await ctx.run(async (tx) => {
    // Yhtiö luetaan käyttäjän RLS-transaktiossa: toisen organisaation yhtiötä ei löydy.
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId.data]);
    if (!company) fail(back, "Taloyhtiötä ei löytynyt.");
    await saveBillingProfile(tx, { organizationId: company.organization_id, companyId: companyId.data, userId: ctx.user.id, ...data });
  });
  revalidatePath("/postikulut");
  redirect(`${back}?tallennettu=1`);
}
