"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { allowRequest } from "@/lib/certificates/rate-limit";
import { CERTIFICATE_KIND, certificatePrice } from "@/lib/certificates/pricing";
import { getDb } from "@/lib/db";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { formatEur } from "@/lib/format";
import { queueMessage } from "@/lib/messaging";
import { resolveAccessLink } from "@/lib/security/access-links";
import { sha256Hex } from "@/lib/security/crypto";

/**
 * Julkinen todistustilaus. Kutsuja ei ole kirjautunut: oikeus perustuu
 * linkkiin (vain tiiviste kannassa), ja kaikki kantakutsut tehdään palvelun
 * roolilla linkin yhtiöön rajattuina. Kevyt rajoitin estää toistuvan
 * lähettämisen samalla linkillä tai samasta osoitteesta.
 */

const orderSchema = z.object({
  share_group_id: z.string().uuid("Valitse huoneisto."),
  kind: z.enum(["manager_certificate", "loan_share_certificate"]).default("manager_certificate"),
  orderer_name: z.string().min(2, "Anna nimesi.").max(200),
  orderer_email: z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200),
  orderer_phone: z.preprocess(emptyToNull, z.string().max(40).regex(/^[+0-9 ()-]*$/, "Puhelinnumero ei ole kelvollinen.").nullable()),
  express: z.preprocess((v) => v === "on", z.boolean()),
  terms: z.literal("on", { message: "Hyväksy tilausehdot." }),
  // Roskapostiansa: ihminen ei täytä piilokenttää.
  website: z.string().max(0).optional().default(""),
});

export async function submitCertificateOrder(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) redirect("/");
  const back = `/todistustilaus/${token}`;

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const tokenKey = sha256Hex(token).slice(0, 16);
  if (!allowRequest(`cert-order:link:${tokenKey}`, 20, 60 * 60 * 1000) || !allowRequest(`cert-order:ip:${sha256Hex(ip).slice(0, 16)}`, 5, 10 * 60 * 1000)) {
    fail(back, "Liian monta tilausta lyhyessä ajassa. Yritä hetken kuluttua uudelleen.");
  }

  const data = parseForm(orderSchema, formData, back);
  const db = await getDb();
  const result = await db.asService(async (tx) => {
    const link = await resolveAccessLink(tx, token, "certificate_order");
    if (!link || link.subjectTable !== "er_housing_companies") return "invalid" as const;
    const [group] = await tx.query<{ id: string; unit_label: string; company_name: string }>(
      `select g.id, g.unit_label, c.name as company_name from er_share_groups g join er_housing_companies c on c.id = g.company_id
        where g.id = $1 and g.company_id = $2 and c.organization_id = $3 and g.removed_on is null`,
      [data.share_group_id, link.subjectId, link.organizationId],
    );
    if (!group) return "no_group" as const;
    const price = certificatePrice(data.express);
    const [order] = await tx.query<{ id: string }>(
      `insert into er_certificate_orders (organization_id, company_id, share_group_id, kind, orderer_name, orderer_email, orderer_phone, express, price_eur, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'public_form') returning id`,
      [link.organizationId, link.subjectId, group.id, data.kind, data.orderer_name, data.orderer_email, data.orderer_phone, data.express, price],
    );
    const kindLabel = CERTIFICATE_KIND[data.kind];
    await queueMessage(tx, {
      organizationId: link.organizationId,
      recipient: data.orderer_email,
      subject: `Tilaus vastaanotettu: ${kindLabel}, ${group.company_name} ${group.unit_label}`,
      body: [
        "Hei,",
        "",
        `olemme vastaanottaneet tilauksesi: ${kindLabel.toLowerCase()}, ${group.company_name}, huoneisto ${group.unit_label}.`,
        `Toimitus: ${data.express ? "pikatoimitus" : "normaali toimitus"}. Hinta ${formatEur(price)}.`,
        "",
        "Ilmoitamme, kun todistus on valmis.",
      ].join("\n"),
      subjectTable: "er_certificate_orders",
      subjectId: order.id,
    });
    await audit(tx, { organizationId: link.organizationId, userId: null, action: "create_public", entity: "certificate_order", entityId: order.id });
    return "ok" as const;
  });

  if (result === "invalid") fail(back, "Tilauslinkki ei ole voimassa.");
  if (result === "no_group") fail(back, "Valitse huoneisto listasta.");
  redirect(`${back}?valmis=1`);
}
