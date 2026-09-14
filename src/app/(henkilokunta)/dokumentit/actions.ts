"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { deleteStoredFile } from "@/lib/storage";
import { DOCUMENT_CATEGORIES, SELECTABLE_VISIBILITIES } from "@/lib/documents/labels";
import { safeBackPath } from "@/lib/documents/queries";

const uuid = z.string().uuid();

const updateSchema = z.object({
  id: uuid,
  title: z.string().min(1, "Anna otsikko.").max(200, "Otsikko on liian pitkä."),
  category: z.enum(DOCUMENT_CATEGORIES),
  visibility: z.enum(SELECTABLE_VISIBILITIES),
  year: z.preprocess(emptyToNull, z.coerce.number().int().min(1900, "Tarkista vuosi.").max(2100, "Tarkista vuosi.").nullable()),
  share_group_id: z.preprocess(emptyToNull, uuid.nullable()),
});

export async function updateDocument(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/dokumentit/${id}`;
  const ctx = await requireStaff();
  const data = parseForm(updateSchema, formData, back);

  await ctx.run(async (tx) => {
    const [doc] = await tx.query<{ organization_id: string; company_id: string | null; visibility: string; share_group_id: string | null; subject_table: string | null }>(
      "select organization_id, company_id, visibility, share_group_id, subject_table from er_documents where id = $1",
      [id],
    );
    if (!doc) fail("/dokumentit", "Dokumenttia ei löytynyt.");
    if (data.share_group_id) {
      const [g] = await tx.query("select id from er_share_groups where id = $1 and company_id = $2", [data.share_group_id, doc.company_id]);
      if (!g) fail(back, "Huoneisto ei kuulu dokumentin yhtiöön.");
    }
    // Huoltomoduulin liitteiden näkyvyys (palveluntuottaja, ilmoittaja) hoidetaan siellä; tästä muutetaan vain perustiedot.
    const visibility = doc.subject_table && !(SELECTABLE_VISIBILITIES as readonly string[]).includes(doc.visibility) ? doc.visibility : data.visibility;
    const rows = await tx.query(
      "update er_documents set title = $2, category = $3, visibility = $4, year = $5, share_group_id = $6 where id = $1 returning id",
      [id, data.title, data.category, visibility, data.year, data.share_group_id],
    );
    if (rows.length === 0) fail(back, "Roolillasi ei voi muokata dokumenttia.");
    await audit(tx, {
      organizationId: doc.organization_id, userId: ctx.user.id, action: "update", entity: "document", entityId: id,
      details: doc.visibility !== visibility || doc.share_group_id !== data.share_group_id
        ? { visibility_from: doc.visibility, visibility_to: visibility, share_group_changed: doc.share_group_id !== data.share_group_id }
        : {},
    });
  });
  revalidatePath("/dokumentit");
  redirect(`${back}?tallennettu=1`);
}

export async function deleteDocument(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = safeBackPath(formData.get("back"));
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(`/dokumentit/${id}`, "Dokumentin poistaa pääkäyttäjä tai isännöitsijä.");

  const storagePath = await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string; storage_path: string; category: string; company_id: string | null; sealed: boolean }>(
      "delete from er_documents where id = $1 and sealed = false returning organization_id, storage_path, category, company_id, sealed",
      [id],
    );
    if (rows.length === 0) fail(`/dokumentit/${id}`, "Dokumenttia ei voitu poistaa. Sinetöityjä asiakirjoja ei poisteta.");
    await audit(tx, {
      organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete", entity: "document", entityId: id,
      details: { category: rows[0].category, company_id: rows[0].company_id },
    });
    return rows[0].storage_path;
  });
  // Tiedosto poistetaan vasta, kun rivin poisto on pysyvä. Epäonnistuminen jättää orvon tiedoston, ei rikkinäistä linkkiä.
  await deleteStoredFile(storagePath).catch(() => undefined);
  revalidatePath("/dokumentit");
  redirect(back);
}
