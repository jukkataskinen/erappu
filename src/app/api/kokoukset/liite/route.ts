import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull } from "@/lib/forms";
import { MAX_UPLOAD_BYTES, deleteStoredFile, storeFile } from "@/lib/storage";
import { DOCUMENT_CATEGORIES } from "@/lib/documents/labels";
import { normalizeDeclaredType } from "@/lib/documents/queries";
import { isSameOriginRequest } from "@/lib/documents/http";
import { AttachmentError, attachDocument, attachmentTarget, attachmentVisibility } from "@/lib/meetings/attachments";

export const dynamic = "force-dynamic";

/**
 * Pykälän liitteen lataus. Reitti eikä server action samasta syystä kuin
 * dokumenttien latauksessa (server actionin runkoraja 1 Mt). Tiedosto
 * tallentuu yhtiön dokumentiksi kokouksen näkyvyydellä (hallituksen kokous:
 * hallitus, yhtiökokous: osakkaat) ja kytketään asiaan.
 */

const uuid = z.string().uuid();
const schema = z.object({
  company_id: uuid,
  meeting_id: uuid,
  item_id: uuid,
  category: z.enum(DOCUMENT_CATEGORIES).default("other"),
  title: z.preprocess((v) => (v === undefined ? null : emptyToNull(v)), z.string().max(200, "Otsikko on liian pitkä.").nullable()),
});

function back(request: Request, path: string, error?: string) {
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("virhe", error);
  url.hash = "asiat";
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers)) return new NextResponse("Kielletty", { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/kirjaudu", request.url), 303);
  if (user.memberships.length === 0) return new NextResponse("Kielletty", { status: 403 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) return back(request, "/kokoukset", "Tiedosto on liian suuri (enintään 20 Mt).");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, "/kokoukset", "Lataus epäonnistui. Yritä uudelleen.");
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v.trim();
  const parsed = schema.safeParse(fields);
  if (!parsed.success) return back(request, "/kokoukset", "Tarkista lomakkeen tiedot.");
  const data = parsed.data;
  const backTo = `/taloyhtiot/${data.company_id}/kokoukset/${data.meeting_id}`;

  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) return back(request, backTo, "Roolillasi ei voi muokata kokouksia.");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(request, backTo, "Valitse liitettävä tiedosto.");
  if (file.size > MAX_UPLOAD_BYTES) return back(request, backTo, "Tiedosto on liian suuri (enintään 20 Mt).");

  // Kokous haetaan käyttäjän RLS:llä ennen tallennusta: toisen organisaation kokoukseen ei tallenneta tiedostoa.
  let target;
  try {
    target = await ctx.run((tx) => attachmentTarget(tx, data.meeting_id, data.item_id));
  } catch (err) {
    return back(request, backTo, err instanceof AttachmentError ? err.message : "Asiaa ei löytynyt.");
  }
  if (target.company_id !== data.company_id) return back(request, backTo, "Asiaa ei löytynyt.");

  let stored;
  try {
    stored = await storeFile({
      organizationId: target.organization_id,
      companyId: target.company_id,
      fileName: file.name,
      mimeType: normalizeDeclaredType(file.name, file.type),
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  } catch (err) {
    const msg = err instanceof Error && /liian suuri|ei sallita/.test(err.message) ? err.message : "Tiedoston tallennus epäonnistui.";
    return back(request, backTo, msg === "Tiedostotyyppiä ei sallita." ? "Tiedostotyyppiä ei sallita. Sallitut: PDF, JPG, PNG, WebP, CSV, XLSX ja DOCX." : msg);
  }

  try {
    await ctx.run(async (tx) => {
      const visibility = attachmentVisibility(target.kind);
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, extract(year from now())::int, $11) returning id`,
        [target.organization_id, target.company_id, data.category, data.title ?? stored.fileName.replace(/\.[^.]+$/, "").replace(/_/g, " "),
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, visibility, ctx.user.id],
      );
      await audit(tx, {
        organizationId: target.organization_id, userId: ctx.user.id, action: "upload", entity: "document", entityId: doc.id,
        details: { category: data.category, visibility, size: stored.sizeBytes, meeting_item: data.item_id },
      });
      await attachDocument(tx, { meetingId: data.meeting_id, itemId: data.item_id, documentId: doc.id, userId: ctx.user.id });
    });
  } catch (err) {
    // Rivi ei syntynyt, joten tiedosto ei saa jäädä varastoon orvoksi.
    await deleteStoredFile(stored.storagePath);
    return back(request, backTo, err instanceof AttachmentError ? err.message : "Liitteen tallennus epäonnistui. Tarkista oikeutesi.");
  }
  return back(request, backTo);
}
