"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import { rotatePublicFormLink } from "@/lib/service-requests/links";
import { RequestError } from "@/lib/service-requests/mutations";
import { uuid } from "@/lib/service-requests/schemas";

/** Luo tai vaihtaa yhtiön julkisen huoltopyyntölomakkeen linkin (QR). */
export async function rotatePublicForm(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/huolto`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi hallita lomakelinkkiä.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await rotatePublicFormLink(tx, { companyId, userId: ctx.user.id });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "rotate", entity: "public_request_form", entityId: companyId });
    }),
  );
  revalidatePath(back);
  redirect(back);
}

const marketplaceSchema = z.object({
  enabled: z.enum(["0", "1"]),
  limit_eur: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(",", ".").replace(/\s/g, ""))) : v),
    z.number({ message: "Anna euroraja numerona." }).positive("Eurorajan on oltava positiivinen.").max(1_000_000).nullable(),
  ),
  decided_on: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna päätöspäivä.").nullable()),
  decision_note: z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(500).nullable()),
});

/** Hallituksen päätös torin käytöstä: euroraja, päätöspäivä ja viittaus pöytäkirjaan (0096). */
export async function saveMarketplaceSettings(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/huolto`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(back, "Torin käytön kirjaa pääkäyttäjä tai isännöitsijä.");
  const parsed = marketplaceSchema.safeParse({
    enabled: formData.get("enabled") === "1" ? "1" : "0",
    limit_eur: formData.get("limit_eur") ?? "",
    decided_on: formData.get("decided_on") ?? "",
    decision_note: formData.get("decision_note") ?? "",
  });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Tarkista torin tiedot.");
  const d = parsed.data;
  const enabled = d.enabled === "1";
  if (enabled && (d.limit_eur === null || d.decided_on === null)) fail(back, "Torin käyttöönotto vaatii hallituksen päätöspäivän ja eurorajan.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const rows = await tx.query(
        `update er_housing_companies set marketplace_enabled = $2, marketplace_limit_eur = $3, marketplace_decided_on = $4, marketplace_decision_note = $5
          where id = $1 returning id`,
        [companyId, enabled, d.limit_eur, d.decided_on, d.decision_note],
      );
      if (rows.length === 0) throw new RequestError("Roolillasi ei voi muuttaa yhtiön tietoja.");
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "housing_company", entityId: companyId,
        details: { marketplace_enabled: enabled, marketplace_limit_eur: d.limit_eur, marketplace_decided_on: d.decided_on },
      });
    }),
  );
  revalidatePath(back);
  redirect(`${back}?tori=tallennettu#tori`);
}
