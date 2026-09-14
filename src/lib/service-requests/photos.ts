import "server-only";
import type { Sql } from "@/lib/db";
import { detectAllowedType, MAX_UPLOAD_BYTES, storeFile } from "@/lib/storage";
import { stripImageMetadata } from "./image-metadata";
import { MAX_PHOTOS_PER_SUBMIT } from "./limits";

/**
 * Huoltopyynnön kuvat. Kuva on er_documents-rivi, ja lisäyksestä kirjataan
 * tapahtuma samaan transaktioon. Tiedostot tarkistetaan kaikki ennen kuin
 * yhtään tallennetaan, jotta osittain onnistunut lähetys ei jätä orpoja.
 */

export { MAX_PHOTOS_PER_SUBMIT };
const PHOTO_TYPES = ["image/jpeg", "image/png"];

export class PhotoError extends Error {}

export function photoFiles(formData: FormData, field = "photos"): File[] {
  return formData
    .getAll(field)
    .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && (v as File).size > 0);
}

interface PreparedPhoto {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

async function preparePhotos(files: File[]): Promise<PreparedPhoto[]> {
  if (files.length > MAX_PHOTOS_PER_SUBMIT) throw new PhotoError(`Voit lisätä enintään ${MAX_PHOTOS_PER_SUBMIT} kuvaa kerralla.`);
  const out: PreparedPhoto[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) throw new PhotoError("Kuva on liian suuri.");
    const raw = Buffer.from(await file.arrayBuffer());
    const declared = PHOTO_TYPES.includes(file.type) ? file.type : "";
    const mime = declared ? detectAllowedType(raw, declared) : null;
    if (!mime) throw new PhotoError("Kuvan pitää olla JPEG- tai PNG-kuva.");
    const clean = stripImageMetadata(raw, mime);
    if (!clean) throw new PhotoError("Kuvaa ei voitu lukea.");
    out.push({ bytes: clean, mimeType: mime, fileName: mime === "image/png" ? "kuva.png" : "kuva.jpg" });
  }
  return out;
}

export async function savePhotos(
  tx: Sql,
  files: File[],
  opts: {
    organizationId: string;
    companyId: string;
    requestId: string;
    visibility: "reporter" | "internal";
    userId: string | null;
    providerActor?: boolean;
  },
): Promise<number> {
  if (files.length === 0) return 0;
  const prepared = await preparePhotos(files);
  for (const p of prepared) {
    const stored = await storeFile({ organizationId: opts.organizationId, companyId: opts.companyId, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes });
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
          visibility, subject_table, subject_id, uploaded_by)
       values ($1,$2,'photo','Huoltopyynnön kuva',$3,$4,$5,$6,$7,$8,'er_service_requests',$9,$10) returning id`,
      [opts.organizationId, opts.companyId, stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256,
        opts.visibility, opts.requestId, opts.userId],
    );
    await tx.query(
      `insert into er_service_request_events (request_id, type, visibility, user_id, provider_actor, document_id)
       values ($1,'attachment',$2,$3,$4,$5)`,
      [opts.requestId, opts.visibility, opts.userId, opts.providerActor ?? false, doc.id],
    );
  }
  return prepared.length;
}
