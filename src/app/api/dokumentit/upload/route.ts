import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff, getCurrentUser } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull } from "@/lib/forms";
import { MAX_UPLOAD_BYTES, deleteStoredFile, storeFile } from "@/lib/storage";
import { DOCUMENT_CATEGORIES, SELECTABLE_VISIBILITIES } from "@/lib/documents/labels";
import { normalizeDeclaredType, safeBackPath } from "@/lib/documents/queries";
import { isSameOriginRequest } from "@/lib/documents/http";

export const dynamic = "force-dynamic";

/**
 * Dokumentin lataus lomakkeelta. Reitti eikä server action, koska server
 * actionien runkoraja on 1 Mt ja dokumentit ovat enintään 20 Mt. Reitti ei
 * saa Nextin server action -alkuperätarkistusta, joten se tehdään itse.
 */

/** Puuttuva kenttä (esim. huoneistovalinta, jota lomakkeessa ei ole) tulkitaan tyhjäksi. */
const missingToNull = (v: unknown) => (v === undefined ? null : emptyToNull(v));

const schema = z.object({
  company_id: z.string().uuid("Valitse taloyhtiö."),
  category: z.enum(DOCUMENT_CATEGORIES, { message: "Valitse luokka." }),
  visibility: z.enum(SELECTABLE_VISIBILITIES, { message: "Valitse näkyvyys." }),
  title: z.preprocess(missingToNull, z.string().max(200, "Otsikko on liian pitkä.").nullable()),
  year: z.preprocess(missingToNull, z.coerce.number().int().min(1900, "Tarkista vuosi.").max(2100, "Tarkista vuosi.").nullable()),
  share_group_id: z.preprocess(missingToNull, z.string().uuid().nullable()),
});

function back(request: Request, path: string, error?: string) {
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("virhe", error);
  // 303: selain hakee kohteen GET-pyynnöllä eikä lähetä lomaketta uudelleen.
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers)) return new NextResponse("Kielletty", { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/kirjaudu", request.url), 303);
  if (user.memberships.length === 0) return new NextResponse("Kielletty", { status: 403 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) return back(request, "/dokumentit", "Tiedosto on liian suuri (enintään 20 Mt).");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, "/dokumentit", "Lataus epäonnistui. Yritä uudelleen.");
  }
  const backTo = safeBackPath(form.get("back"));
  const ctx = await requireStaff();

  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v.trim();
  const parsed = schema.safeParse(fields);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return back(request, backTo, msg && !msg.startsWith("Invalid") ? msg : "Tarkista lomakkeen tiedot.");
  }
  const data = parsed.data;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(request, backTo, "Valitse ladattava tiedosto.");
  if (file.size > MAX_UPLOAD_BYTES) return back(request, backTo, "Tiedosto on liian suuri (enintään 20 Mt).");

  // Yhtiö ja huoneisto haetaan käyttäjän RLS:llä ennen tallennusta: toisen organisaation yhtiöön ei tallenneta tiedostoa lainkaan.
  const target = await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [data.company_id]);
    if (!company) return null;
    if (data.share_group_id) {
      const [g] = await tx.query("select id from er_share_groups where id = $1 and company_id = $2", [data.share_group_id, data.company_id]);
      if (!g) return null;
    }
    return company;
  });
  if (!target) return back(request, backTo, "Taloyhtiötä tai huoneistoa ei löytynyt.");
  if (!ctx.user.memberships.some((m) => m.organizationId === target.organization_id)) return back(request, backTo, "Taloyhtiötä ei löytynyt.");

  let stored;
  try {
    stored = await storeFile({
      organizationId: target.organization_id,
      companyId: data.company_id,
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
      const [row] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [target.organization_id, data.company_id, data.share_group_id, data.category, data.title ?? stored.fileName.replace(/\.[^.]+$/, "").replace(/_/g, " "),
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, data.visibility, data.year, ctx.user.id],
      );
      await audit(tx, {
        organizationId: target.organization_id, userId: ctx.user.id, action: "upload", entity: "document", entityId: row.id,
        details: { category: data.category, visibility: data.visibility, size: stored.sizeBytes },
      });
    });
  } catch {
    // Rivi ei syntynyt (esim. rooli ei salli), joten tiedosto ei saa jäädä varastoon orvoksi.
    await deleteStoredFile(stored.storagePath);
    return back(request, backTo, "Dokumentin tallennus epäonnistui. Tarkista oikeutesi.");
  }
  return back(request, backTo);
}
