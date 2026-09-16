import "server-only";
import type { Sql } from "@/lib/db";
import { normalizeDeclaredType } from "@/lib/documents/queries";
import { stripImageMetadata } from "@/lib/service-requests/image-metadata";
import { detectAllowedType, MAX_UPLOAD_BYTES, sanitizeFileName, storeFile } from "@/lib/storage";
import { MAX_NOTICE_ATTACHMENTS } from "./notice-form";

/**
 * Muutostyöilmoituksen liitteet (suunnitelmat, pohjapiirustukset, kuvat,
 * urakoitsijan tarjous). Liite on er_documents-rivi, joka on sidottu
 * ilmoitukseen (`subject_table`), jolloin se ei sekoitu dokumenttipankkiin.
 *
 * Näkyvyys on 'owners' ja rivillä on huoneisto, jolloin liitteen näkevät
 * huoneiston osakas, hallitus ja henkilökunta – eivät muut osakkaat
 * (0041 portal_owner_docs) eivätkä vuokralaiset.
 *
 * Tiedostot tarkistetaan kaikki ennen kuin yhtään tallennetaan, jotta
 * osittain onnistunut lähetys ei jätä orpoja tiedostoja varastoon.
 */

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

/** Sallitut liitetyypit. Sama joukko kuin dokumenttipankissa (src/lib/storage). */
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx";

/** Liitteiden yhteiskoko. Sama raja kuin yhdelle dokumentille, jotta pyyntö mahtuu palvelintoiminnon rajaan. */
export const MAX_NOTICE_ATTACHMENT_TOTAL = MAX_UPLOAD_BYTES;

export function attachmentFiles(formData: FormData, field = "attachments"): File[] {
  return formData
    .getAll(field)
    .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && (v as File).size > 0);
}

export interface PreparedAttachment {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

export async function prepareAttachments(files: File[]): Promise<PreparedAttachment[]> {
  if (files.length > MAX_NOTICE_ATTACHMENTS) throw new AttachmentError(`Voit lisätä enintään ${MAX_NOTICE_ATTACHMENTS} liitettä.`);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_NOTICE_ATTACHMENT_TOTAL) throw new AttachmentError("Liitteet ovat yhteensä liian suuret. Lähetä isot suunnitelmat isännöitsijälle erikseen.");
  const out: PreparedAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) throw new AttachmentError("Liite on liian suuri.");
    const raw = Buffer.from(await file.arrayBuffer());
    const declared = normalizeDeclaredType(file.name, ALLOWED_TYPES.includes(file.type) ? file.type : "");
    const mime = declared ? detectAllowedType(raw, declared) : null;
    if (!mime || !ALLOWED_TYPES.includes(mime)) {
      throw new AttachmentError("Liitteen pitää olla PDF, kuva (JPEG, PNG, WEBP), Word- tai Excel-tiedosto.");
    }
    // Kuvasta poistetaan sijaintitieto, kuten huoltopyynnön kuvista.
    let bytes: Buffer = raw;
    if (mime === "image/jpeg" || mime === "image/png") {
      const clean = stripImageMetadata(raw, mime);
      if (!clean) throw new AttachmentError("Kuvaa ei voitu lukea.");
      bytes = clean;
    }
    out.push({ bytes, mimeType: mime, fileName: sanitizeFileName(file.name || "liite") });
  }
  return out;
}

export async function saveNoticeAttachments(
  tx: Sql,
  files: File[],
  opts: { organizationId: string; companyId: string; shareGroupId: string; noticeId: string; userId: string },
): Promise<number> {
  if (files.length === 0) return 0;
  const prepared = await prepareAttachments(files);
  for (const p of prepared) {
    const stored = await storeFile({ organizationId: opts.organizationId, companyId: opts.companyId, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes });
    await tx.query(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
          visibility, subject_table, subject_id, uploaded_by)
       values ($1,$2,$3,$4,'Muutostyöilmoituksen liite',$5,$6,$7,$8,$9,'owners','er_renovation_notices',$10,$11)`,
      [opts.organizationId, opts.companyId, opts.shareGroupId, p.mimeType.startsWith("image/") ? "photo" : "other",
        stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, opts.noticeId, opts.userId],
    );
  }
  return prepared.length;
}
