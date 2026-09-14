"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortal } from "@/lib/auth/current-user";
import type { Sql } from "@/lib/db";
import { fail, parseForm } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { addComment, createRequest, RequestError } from "@/lib/service-requests/mutations";
import { photoFiles, savePhotos } from "@/lib/service-requests/photos";
import { portalRequestSchema, titleFromDescription, uuid } from "@/lib/service-requests/schemas";

/**
 * Portaalin huoltopyyntötoiminnot. Kaikki ajetaan käyttäjän RLS-transaktiossa:
 * portaalikäyttäjä voi luoda pyynnön vain yhtiöön ja huoneistoon, johon hänellä
 * on oikeus, ja muuttaa vain omaa pyyntöään kannan funktion kautta.
 */

export async function createPortalRequest(formData: FormData) {
  const back = "/portaali/huoltopyynnot/uusi";
  const ctx = await requirePortal();
  const d = parseForm(portalRequestSchema, formData, back);
  const [companyId, shareGroupId = null] = d.target.split("|");
  const grant = ctx.user.portal.find(
    (g) => g.companyId === companyId && g.role !== "provider" && (shareGroupId ? g.shareGroupId === shareGroupId : true),
  );
  if (!grant) fail(back, "Valitse yhtiö ja huoneisto.");
  const photos = photoFiles(formData);

  const created = await guarded(back, () =>
    ctx.run(async (tx) => {
      const r = await createRequest(tx, {
        companyId, shareGroupId, unitText: null,
        title: titleFromDescription(d.description, CATEGORY_LABEL[d.category]),
        description: d.description, category: d.category, urgency: d.urgency,
        mayUseMasterKey: d.may_use_master_key, hasPets: d.has_pets, source: "portal",
        reporterUserId: ctx.user.id, reporterName: ctx.user.fullName, reporterPhone: d.reporter_phone, reporterEmail: ctx.user.email,
      });
      await savePhotos(tx, photos, { organizationId: r.organizationId, companyId, requestId: r.id, visibility: "reporter", userId: ctx.user.id });
      return r;
    }),
  );
  revalidatePath("/portaali/huoltopyynnot");
  redirect(`/portaali/huoltopyynnot/${created.id}?uusi=1`);
}

async function ownRequest(tx: Sql, id: string, userId: string) {
  const [r] = await tx.query<{ id: string; organization_id: string; company_id: string }>(
    "select id, organization_id, company_id from er_service_requests where id = $1 and reporter_user_id = $2",
    [id, userId],
  );
  if (!r) throw new RequestError("Huoltopyyntöä ei löytynyt.");
  return r;
}

export async function reporterAction(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/portaali/huoltopyynnot/${id}`;
  const ctx = await requirePortal();
  const action = z.enum(["close", "reopen"]).safeParse(formData.get("action"));
  if (!action.success) fail(back, "Tuntematon toiminto.");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 5000);
  if (action.data === "reopen" && comment.length < 3) fail(back, "Kerro lyhyesti, miksi avaat pyynnön uudelleen.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await tx.query("select er_service_request_reporter_action($1, $2, $3)", [id, action.data, comment || null]);
    }),
  );
  revalidatePath(back);
  redirect(back);
}

export async function portalComment(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/portaali/huoltopyynnot/${id}`;
  const ctx = await requirePortal();
  const body = z.string().trim().min(1).max(5000).safeParse(formData.get("body"));
  if (!body.success) fail(back, "Kirjoita viesti.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await ownRequest(tx, id, ctx.user.id);
      await addComment(tx, { requestId: id, body: body.data, visibility: "reporter", actor: { userId: ctx.user.id } });
    }),
  );
  revalidatePath(back);
  redirect(back);
}

export async function portalPhotos(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/portaali/huoltopyynnot/${id}`;
  const ctx = await requirePortal();
  const photos = photoFiles(formData);
  if (photos.length === 0) fail(back, "Valitse vähintään yksi kuva.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const r = await ownRequest(tx, id, ctx.user.id);
      await savePhotos(tx, photos, { organizationId: r.organization_id, companyId: r.company_id, requestId: id, visibility: "reporter", userId: ctx.user.id });
    }),
  );
  revalidatePath(back);
  redirect(back);
}
