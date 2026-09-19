import "server-only";
import type { Sql } from "@/lib/db";
import { FinanceError } from "@/lib/finance/billing";
import { AttachmentError, prepareAttachments } from "@/lib/maintenance/attachments";
import { deleteStoredFile, storeFile } from "@/lib/storage";

/**
 * Kuva vesimittarista portaalin lukemailmoitukseen (0110). Kuva liitetään
 * ilmoittajan omaan lukemaan; sijaintitieto poistetaan kuten muista kuvista.
 */
export async function attachReadingPhoto(tx: Sql, opts: { meterId: string; roundId: string; userId: string; file: File }): Promise<string> {
  let prepared;
  try {
    prepared = await prepareAttachments([opts.file]);
  } catch (err) {
    throw new FinanceError(err instanceof AttachmentError ? err.message : "Kuvaa ei voitu lukea.");
  }
  const p = prepared[0];
  if (!p.mimeType.startsWith("image/")) throw new FinanceError("Mittarin kuvan pitää olla JPEG-, PNG- tai WEBP-kuva.");
  const [reading] = await tx.query<{ id: string; organization_id: string; company_id: string; share_group_id: string; unit_label: string }>(
    `select r.id, m.organization_id, m.company_id, m.share_group_id, g.unit_label
       from er_water_readings r join er_water_meters m on m.id = r.meter_id join er_share_groups g on g.id = m.share_group_id
      where r.meter_id = $1 and r.round_id = $2 and r.entered_by = $3 and r.source = 'portal'`,
    [opts.meterId, opts.roundId, opts.userId],
  );
  if (!reading) throw new FinanceError("Kuvan voi liittää vain omaan ilmoittamaasi lukemaan.");
  const stored = await storeFile({ organizationId: reading.organization_id, companyId: reading.company_id, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes });
  try {
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
          visibility, subject_table, subject_id, uploaded_by)
       values ($1,$2,$3,'photo',$4,$5,$6,$7,$8,$9,'internal','er_water_readings',$10,$11) returning id`,
      [reading.organization_id, reading.company_id, reading.share_group_id, `Vesimittarin kuva, ${reading.unit_label}`, stored.fileName, stored.storagePath,
        stored.mimeType, stored.sizeBytes, stored.sha256, reading.id, opts.userId],
    );
    return doc.id;
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}

/** Lukemien kuvat kierrokselta henkilökunnalle: lukeman id → uusimman kuvan dokumentti-id. */
export async function roundPhotos(tx: Sql, roundId: string): Promise<Map<string, string>> {
  const rows = await tx.query<{ reading_id: string; id: string }>(
    `select distinct on (d.subject_id) d.subject_id as reading_id, d.id
       from er_documents d join er_water_readings r on r.id = d.subject_id
      where d.subject_table = 'er_water_readings' and r.round_id = $1
      order by d.subject_id, d.created_at desc`,
    [roundId],
  );
  return new Map(rows.map((r) => [r.reading_id, r.id]));
}
