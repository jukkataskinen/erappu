"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { fail, parseForm } from "@/lib/forms";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { resolvePublicForm } from "@/lib/service-requests/links";
import { createRequest, queueReceivedConfirmation } from "@/lib/service-requests/mutations";
import { clientIp, clientKey, hitRateLimit, PUBLIC_FORM_LIMIT } from "@/lib/service-requests/rate-limit";
import { publicRequestSchema, titleFromDescription } from "@/lib/service-requests/schemas";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Julkisen lomakkeen lähetys. Ei kirjautumista: kohde (yhtiö) tulee aina
 * linkistä, ei lomakkeelta, ja kaikki kyselyt ajetaan palvelun roolilla
 * linkin organisaatioon ja yhtiöön rajattuina.
 */
export async function submitPublicRequest(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) notFound();
  const back = `/ilmoita/${token}`;
  const h = await headers();
  const bucket = `public_form:${clientKey(clientIp(h.get("x-forwarded-for"), h.get("x-real-ip")))}`;
  const db = await getDb();

  // Laskuri kasvatetaan omassa transaktiossaan, jotta hylätty lähetys ei peru sitä.
  const gate = await db.asService(async (tx) => {
    const target = await resolvePublicForm(tx, token);
    if (!target) return null;
    const rl = await hitRateLimit(tx, { organizationId: target.organizationId, bucket, ...PUBLIC_FORM_LIMIT });
    return { allowed: rl.allowed };
  });
  if (!gate) fail(back, "Lomake ei ole enää käytössä. Ota yhteys isännöintiin.");
  if (!gate.allowed) {
    fail(back, "Lomakkeelta on lähetetty useita pyyntöjä lyhyessä ajassa. Yritä myöhemmin uudelleen. Kiireellisessä viassa soita päivystykseen.");
  }

  const d = parseForm(publicRequestSchema, formData, back);
  const created = await db.asService(async (tx) => {
    const target = await resolvePublicForm(tx, token);
    if (!target) return null;
    const r = await createRequest(tx, {
      companyId: target.companyId,
      shareGroupId: null,
      unitText: d.unit_text,
      title: titleFromDescription(d.description, CATEGORY_LABEL[d.category]),
      description: d.description,
      category: d.category,
      urgency: d.category === "water_damage" ? "urgent" : "normal",
      mayUseMasterKey: false,
      hasPets: false,
      source: "public_form",
      reporterUserId: null,
      reporterName: d.reporter_name,
      reporterPhone: d.reporter_phone,
      reporterEmail: d.reporter_email,
    });
    await queueReceivedConfirmation(tx, { requestId: r.id, email: d.reporter_email });
    await audit(tx, { organizationId: target.organizationId, userId: null, action: "create", entity: "service_request", entityId: r.id, details: { source: "public_form" } });
    return r;
  });
  if (!created) fail(back, "Lomake ei ole enää käytössä. Ota yhteys isännöintiin.");
  redirect(`${back}?kiitos=${created.number}`);
}
