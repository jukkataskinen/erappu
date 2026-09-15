import "server-only";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db";
import { markRoundCompleted, type SubjectHandler } from "@/lib/signing/rounds";

/**
 * Massaluonnin sopimuksen allekirjoitustapahtumat. Reititys ja idempotenssi
 * ovat yhteisiä (`src/lib/signing/process.ts`); tämä tietää vain, mitä
 * sopimukselle tapahtuu.
 *
 * Valmis: sinetöity PDF dokumentiksi (hallitukselle), rivi `signed`,
 * sopimusrekisterin asiakirjaksi sinetöity versio ja allekirjoittamaton
 * luonnos piiloon hallitukselta, jotta yhtiöllä näkyy vain yksi kappale.
 */

interface ItemMeta {
  id: string;
  batch_id: string;
  company_id: string;
  contract_id: string | null;
  document_id: string | null;
  document_title: string | null;
  shared_values: Record<string, unknown>;
}

async function loadItem(tx: Sql, itemId: string): Promise<ItemMeta> {
  const [item] = await tx.query<ItemMeta>(
    `select i.id, i.batch_id, i.company_id, i.contract_id, i.document_id, d.title as document_title, b.shared_values
       from er_contract_batch_items i
       join er_contract_batches b on b.id = i.batch_id
       left join er_documents d on d.id = i.document_id
      where i.id = $1`,
    [itemId],
  );
  if (!item) throw new Error("Sopimusta ei löytynyt.");
  return item;
}

/** Erä valmistuu, kun jokainen rivi on allekirjoitettu tai peruttu (ja vähintään yksi allekirjoitettu). */
async function completeIfDone(tx: Sql, batchId: string) {
  await tx.query(
    `update er_contract_batches set status = 'completed'
      where id = $1 and status <> 'cancelled'
        and exists (select 1 from er_contract_batch_items where batch_id = $1 and status = 'signed')
        and not exists (select 1 from er_contract_batch_items where batch_id = $1 and status not in ('signed', 'cancelled'))`,
    [batchId],
  );
}

export const contractSigningHandler: SubjectHandler = {
  subjectTable: "er_contract_batch_items",
  refKind: "contract",

  async sealedFile(db, round) {
    const item = await db.asService((tx) => loadItem(tx, round.subject_id));
    const until = typeof item.shared_values.valid_until === "string" ? item.shared_values.valid_until : new Date().toISOString().slice(0, 10);
    return { companyId: item.company_id, fileName: `sopimus-allekirjoitettu-${until}.pdf` };
  },

  async onCompleted(tx, round, event, stored) {
    const item = await loadItem(tx, round.subject_id);
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                 visibility, year, subject_table, subject_id, sealed)
       values ($1,$2,'contract',$3,$4,$5,$6,$7,$8,'board',$9,'er_contract_batch_items',$10,true) returning id`,
      [round.organization_id, item.company_id, `${item.document_title ?? "Sopimus"} (allekirjoitettu)`.slice(0, 300),
        stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, new Date().getFullYear(), item.id],
    );
    await markRoundCompleted(tx, round, event, doc.id);
    await tx.query("update er_contract_batch_items set status = 'signed', error = null, sealed_document_id = $2 where id = $1", [item.id, doc.id]);
    if (item.contract_id) await tx.query("update er_contracts set document_id = $2 where id = $1", [item.contract_id, doc.id]);
    if (item.document_id) await tx.query("update er_documents set visibility = 'internal' where id = $1 and not sealed", [item.document_id]);
    await completeIfDone(tx, item.batch_id);
    await audit(tx, { organizationId: round.organization_id, userId: null, action: "contract_signed", entity: "contract_batch_item", entityId: item.id, details: { documentId: doc.id, contractId: item.contract_id } });
  },

  async onStatus(tx, round, event) {
    const next = event.event === "signer.declined" ? "declined" : event.event === "round.cancelled" || event.event === "round.expired" ? "cancelled" : null;
    if (!next) return;
    const rows = await tx.query<{ batch_id: string }>(
      "update er_contract_batch_items set status = $2 where id = $1 and status = 'sent' and signing_round_id = $3 returning batch_id",
      [round.subject_id, next, round.id],
    );
    if (rows.length === 0) return;
    if (next === "cancelled") await completeIfDone(tx, rows[0].batch_id);
    await audit(tx, { organizationId: round.organization_id, userId: null, action: `contract_${next}`, entity: "contract_batch_item", entityId: round.subject_id, details: { event: event.event } });
  },
};
