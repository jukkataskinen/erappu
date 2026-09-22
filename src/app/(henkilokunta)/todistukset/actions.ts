"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { orderPrice } from "@/lib/certificates/pricing";
import { generateCertificateForOrder, loadPrices, markOrderDelivered, saveOrderOptions } from "@/lib/certificates/orders";
import { CertificateError } from "@/lib/certificates/assemble";
import { sealCertificateOrder } from "@/lib/certificates/sealing";
import { assertRealEsinetti, getEsinettiClient, isEsinettiError } from "@/lib/esinetti";
import { createAccessLink, revokeAccessLinks } from "@/lib/security/access-links";
import { signValue } from "@/lib/security/crypto";
import { ORDER_LINK_FLASH_COOKIE } from "@/lib/certificates/order-link";

const uuid = z.string().uuid();

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi käsitellä todistuksia.");
  return ctx;
}

function safeBack(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return /^\/(todistukset(\/[0-9a-f-]{36})?|taloyhtiot\/[0-9a-f-]{36}\/(kokoukset|todistukset))$/.test(v) ? v : "/todistukset";
}

/** Muodostus, jonka virhe näytetään lomakkeella (esim. liian suuri tai jo sinetöity) eikä kaada sivua. */
async function generateOrFail(run: Parameters<typeof generateCertificateForOrder>[0], userId: string, orderId: string, back: string) {
  let message: string | null = null;
  let result: Awaited<ReturnType<typeof generateCertificateForOrder>> = null;
  try {
    result = await generateCertificateForOrder(run, userId, orderId);
  } catch (err) {
    if (err instanceof CertificateError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
  return result;
}

export async function createOrderLinkAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const companyId = uuid.parse(formData.get("company_id"));
  const token = await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
    if (!company) return null;
    // Yksi voimassa oleva linkki yhtiötä kohden: uusi mitätöi vanhan.
    await revokeAccessLinks(tx, "er_housing_companies", companyId, "certificate_order");
    const t = await createAccessLink(tx, {
      organizationId: company.organization_id, purpose: "certificate_order", subjectTable: "er_housing_companies", subjectId: companyId,
      expiresInDays: 365, createdBy: ctx.user.id,
    });
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create_order_link", entity: "housing_company", entityId: companyId });
    return t;
  });
  if (!token) fail(back, "Yhtiötä ei löytynyt.");
  (await cookies()).set(ORDER_LINK_FLASH_COOKIE, signValue(`${companyId}:${token}`), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 120, path: back,
  });
  revalidatePath(back);
  redirect(back);
}

export async function revokeOrderLinkAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const companyId = uuid.parse(formData.get("company_id"));
  await ctx.run((tx) => revokeAccessLinks(tx, "er_housing_companies", companyId, "certificate_order"));
  revalidatePath(back);
  redirect(back);
}

const staffOrderSchema = z.object({
  share_group_id: uuid,
  kind: z.enum(["manager_certificate", "loan_share_certificate"]).default("manager_certificate"),
  orderer_name: z.preprocess(emptyToNull, z.string().max(200).nullable()),
  orderer_email: z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200).nullable()),
  orderer_phone: z.preprocess(emptyToNull, z.string().max(40).nullable()),
  express: z.preprocess((v) => v === "on", z.boolean()),
  purpose: z.preprocess(emptyToNull, z.enum(["bank", "sale", "rental", "other"]).nullable()),
  purpose_text: z.preprocess(emptyToNull, z.string().max(200).nullable()),
  with_attachments: z.preprocess((v) => v === "yes", z.boolean()),
});

/**
 * "Uusi todistus" suoraan huoneistosta. Ilman liitteitä PDF tehdään heti;
 * liitteineen siirrytään tilauksen sivulle, jossa laatija näkee liitteiden
 * saatavuuden ja voi poistaa yksittäisen liitteen ennen muodostusta.
 */
export async function createStaffCertificateAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const d = parseForm(staffOrderSchema, formData, back);
  if (d.purpose === "other" && !d.purpose_text) fail(back, "Kerro todistuksen käyttötarkoitus.");
  const orderId = await ctx.run(async (tx) => {
    const [g] = await tx.query<{ organization_id: string; company_id: string }>("select organization_id, company_id from er_share_groups where id = $1", [d.share_group_id]);
    if (!g) return null;
    const price = orderPrice(await loadPrices(tx, g.organization_id), { express: d.express, withAttachments: d.with_attachments });
    const [row] = await tx.query<{ id: string }>(
      `insert into er_certificate_orders (organization_id, company_id, share_group_id, kind, orderer_name, orderer_email, orderer_phone, express, price_eur, source, created_by,
                                          purpose, purpose_text, with_attachments)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff',$10,$11,$12,$13) returning id`,
      [g.organization_id, g.company_id, d.share_group_id, d.kind, d.orderer_name ?? (ctx.user.fullName || "Isännöinti"), d.orderer_email ?? ctx.user.email,
        d.orderer_phone, d.express, price, ctx.user.id, d.purpose, d.purpose === "other" ? d.purpose_text : null, d.with_attachments],
    );
    await audit(tx, { organizationId: g.organization_id, userId: ctx.user.id, action: "create", entity: "certificate_order", entityId: row.id });
    return row.id;
  });
  if (!orderId) fail(back, "Huoneistoa ei löytynyt.");
  if (d.with_attachments) {
    revalidatePath(back);
    redirect(`/todistukset/${orderId}`);
  }
  await generateOrFail(ctx.run, ctx.user.id, orderId, back);
  revalidatePath(back);
  redirect(back);
}

export async function generateCertificateAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const orderId = uuid.parse(formData.get("order_id"));
  const result = await generateOrFail(ctx.run, ctx.user.id, orderId, back);
  if (!result) fail(back, "Todistusta ei voitu tehdä tälle tilaukselle.");
  revalidatePath(back);
  revalidatePath(`/todistukset/${orderId}`);
  redirect(back);
}

const optionsSchema = z.object({
  order_id: uuid,
  with_attachments: z.preprocess((v) => v === "yes", z.boolean()),
  purpose: z.preprocess(emptyToNull, z.enum(["bank", "sale", "rental", "other"]).nullable()),
  purpose_text: z.preprocess(emptyToNull, z.string().max(200).nullable()),
  intent: z.enum(["save", "generate"]).default("save"),
  // Maksutilanne kirjanpidosta (0115): tyhjä = ei tarkistettu, none = ei erääntyneitä, overdue = summa.
  payment_state: z.preprocess(emptyToNull, z.enum(["none", "overdue"]).nullable()),
  payment_overdue_eur: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? Number(v.trim().replace(/s/g, "").replace(",", ".")) : null),
    z.number({ message: "Tarkista erääntyneiden maksujen summa." }).min(0, "Tarkista erääntyneiden maksujen summa.").max(10_000_000).nullable(),
  ),
  payment_checked_on: z.preprocess(emptyToNull, z.string().regex(/^d{4}-d{2}-d{2}$/, "Tarkista maksutilanteen päivä.").nullable()),
});

/**
 * Tilauksen liitevalinnat. Lomakkeella on ruksi jokaiselle saatavilla
 * olevalle liitteelle (`include_<luokka>`), oletuksena valittuna; ruksittomat
 * tallennetaan poistetuiksi. Hinta päivitetään valinnan mukaan.
 */
export async function saveOrderOptionsAction(formData: FormData) {
  const orderId = uuid.parse(formData.get("order_id"));
  const back = `/todistukset/${orderId}`;
  const ctx = await writer(back);
  const d = parseForm(optionsSchema, formData, back);
  if (d.purpose === "other" && !d.purpose_text) fail(back, "Kerro todistuksen käyttötarkoitus.");
  if (d.payment_state === "overdue" && !(d.payment_overdue_eur && d.payment_overdue_eur > 0)) fail(back, "Anna erääntyneiden maksujen summa.");
  if (d.payment_state && !d.payment_checked_on) fail(back, "Anna päivä, jolta maksutilanne on tarkistettu.");
  const payment = d.payment_state ? { overdueEur: d.payment_state === "none" ? 0 : d.payment_overdue_eur!, checkedOn: d.payment_checked_on! } : null;
  const offered = formData.getAll("offered").filter((v): v is string => typeof v === "string");
  const excluded = offered.filter((key) => formData.get(`include_${key}`) !== "on");
  const ok = await ctx.run(async (tx) => {
    const [o] = await tx.query<{ organization_id: string; express: boolean; with_attachments: boolean }>(
      "select organization_id, express, with_attachments from er_certificate_orders where id = $1",
      [orderId],
    );
    if (!o) return false;
    // Hinta muuttuu vain, kun liitteineen-valinta muuttuu; käsin sovittu hinta säilyy muuten.
    const price = o.with_attachments === d.with_attachments ? null : orderPrice(await loadPrices(tx, o.organization_id), { express: o.express, withAttachments: d.with_attachments });
    return saveOrderOptions(tx, ctx.user.id, orderId, { withAttachments: d.with_attachments, excluded, purpose: d.purpose, purposeText: d.purpose_text, price, payment });
  });
  if (!ok) fail(back, "Tilausta ei voi enää muuttaa.");
  if (d.intent === "generate") {
    const result = await generateOrFail(ctx.run, ctx.user.id, orderId, back);
    if (!result) fail(back, "Todistusta ei voitu tehdä tälle tilaukselle.");
  }
  revalidatePath(back);
  redirect(`${back}?tila=${d.intent === "generate" ? "muodostettu" : "tallennettu"}`);
}

/**
 * Sinetöinti eSinetillä. Vain pääkäyttäjä ja isännöitsijä: sinetti varmentaa
 * isännöitsijän antaman todistuksen, ja sinetöimätön versio poistetaan.
 * Jäljitelmätilassa (kehitys) sinetöinti tehdään mockilla heti; tuotannossa
 * mock estetään (`assertRealEsinetti`).
 */
export async function sealCertificateAction(formData: FormData) {
  const orderId = uuid.parse(formData.get("order_id"));
  const back = `/todistukset/${orderId}`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(back, "Todistuksen sinetöi pääkäyttäjä tai isännöitsijä.");
  let message: string | null = null;
  try {
    assertRealEsinetti();
    await sealCertificateOrder(ctx.run, ctx.user.id, orderId, { client: getEsinettiClient() });
  } catch (err) {
    if (err instanceof CertificateError || isEsinettiError(err)) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
  revalidatePath(back);
  redirect(`${back}?tila=sinetoity`);
}

export async function markDeliveredAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const orderId = uuid.parse(formData.get("order_id"));
  const ok = await ctx.run(async (tx) => {
    const [o] = await tx.query<{ document_id: string | null }>("select document_id from er_certificate_orders where id = $1", [orderId]);
    if (!o?.document_id) return "no_document" as const;
    return (await markOrderDelivered(tx, ctx.user.id, orderId)) ? ("ok" as const) : ("not_found" as const);
  });
  if (ok === "no_document") fail(back, "Tee todistus ennen toimitetuksi merkitsemistä.");
  if (ok === "not_found") fail(back, "Tilausta ei löytynyt tai se on jo toimitettu.");
  revalidatePath(back);
  redirect(back);
}

export async function setOrderStatusAction(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const ctx = await writer(back);
  const orderId = uuid.parse(formData.get("order_id"));
  const status = z.enum(["invoiced", "cancelled"]).parse(formData.get("status"));
  const from = status === "invoiced" ? ["delivered"] : ["new", "in_progress"];
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_certificate_orders set status = $2 where id = $1 and status = any($3::text[]) returning organization_id",
      [orderId, status, from],
    );
    if (rows[0]) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: `status_${status}`, entity: "certificate_order", entityId: orderId });
  });
  revalidatePath(back);
  redirect(back);
}
