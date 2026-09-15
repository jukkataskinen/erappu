import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildExternalRef, type EsinettiClient } from "@/lib/esinetti";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, readStoredFile, storeFile } from "@/lib/storage";
import { CertificateError } from "./assemble";
import { MAX_MERGED_BYTES } from "./pdf-merge";

/**
 * Valmiin isännöitsijäntodistuksen sinetöinti eSinetillä (sähköinen leima).
 *
 * eSinetin `POST /documents/seal` sinetöi asiakirjan ilman allekirjoittajia
 * ja palauttaa sinetöidyn tiedoston heti, joten kierrosta ja webhookia ei
 * tarvita. Sinetöity PDF tallennetaan uutena dokumenttina, tilaus osoittaa
 * siihen, ja sinetöimätön versio poistetaan (se korvataan). Tapahtuma
 * kirjataan `er_signing_rounds`-tauluun samalla kohdemallilla kuin
 * kokousten ja sopimusten kierrokset, jotta kaikki sähköiset varmennukset
 * löytyvät yhdestä paikasta.
 */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface SealDeps {
  client: EsinettiClient;
  store?: typeof storeFile;
  remove?: typeof deleteStoredFile;
  read?: (storagePath: string) => Promise<Uint8Array>;
  /** Sinetöidyn tiedoston lataus eSinetin aikarajallisesta osoitteesta (mockissa data:-osoite). */
  download?: (url: string) => Promise<Uint8Array>;
}

async function defaultDownload(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new CertificateError("Sinetöityä todistusta ei saatu ladattua. Yritä hetken kuluttua uudelleen.");
  return new Uint8Array(await res.arrayBuffer());
}

export async function sealCertificateOrder(run: Runner, userId: string, orderId: string, deps: SealDeps): Promise<{ documentId: string }> {
  const store = deps.store ?? storeFile;
  const remove = deps.remove ?? deleteStoredFile;
  const read = deps.read ?? (async (p: string) => new Uint8Array(await readStoredFile(p)));
  const download = deps.download ?? defaultDownload;

  const current = await run(async (tx) => {
    const [row] = await tx.query<{
      organization_id: string; company_id: string; share_group_id: string; status: string; sealed_at: string | null; document_id: string | null;
      storage_path: string | null; title: string | null; file_name: string | null; unit_label: string;
    }>(
      `select o.organization_id, o.company_id, o.share_group_id, o.status, o.sealed_at, o.document_id, d.storage_path, d.title, d.file_name, g.unit_label
         from er_certificate_orders o
         join er_share_groups g on g.id = o.share_group_id
         left join er_documents d on d.id = o.document_id
        where o.id = $1`,
      [orderId],
    );
    return row ?? null;
  });
  if (!current) throw new CertificateError("Tilausta ei löytynyt.");
  if (current.status === "cancelled") throw new CertificateError("Peruttua todistusta ei sinetöidä.");
  if (current.sealed_at) throw new CertificateError("Todistus on jo sinetöity.");
  if (!current.document_id || !current.storage_path) throw new CertificateError("Muodosta todistus ennen sinetöintiä.");

  const original = await read(current.storage_path);
  const sealedMeta = await deps.client.sealDocument({
    name: current.file_name ?? `isannoitsijantodistus-${current.unit_label}.pdf`,
    pdfBytes: original,
    // Upotetaan pysyvästi sinetöityyn asiakirjaan: vain kohdetunniste, ei henkilötietoja.
    metadata: { externalRef: buildExternalRef("certificate", orderId), documentType: "isannoitsijantodistus" },
    reason: "Isännöitsijäntodistus",
    retainYears: 10,
  });
  const sealedBytes = await download(sealedMeta.downloadUrl);
  if (Buffer.from(sealedBytes.subarray(0, 4)).toString("latin1") !== "%PDF") throw new CertificateError("Sinetöity asiakirja ei ole PDF.");

  const stored = await store({
    organizationId: current.organization_id,
    companyId: current.company_id,
    fileName: (current.file_name ?? `isannoitsijantodistus-${current.unit_label}-${isoDateHelsinki()}.pdf`).replace(/\.pdf$/i, "-sinetoity.pdf"),
    mimeType: "application/pdf",
    bytes: Buffer.from(sealedBytes),
    maxBytes: MAX_MERGED_BYTES + 1024 * 1024,
  });

  let documentId: string;
  try {
    documentId = await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                   visibility, year, subject_table, subject_id, sealed, uploaded_by)
         values ($1,$2,$3,'manager_certificate',$4,$5,$6,$7,$8,$9,'internal',$10,'er_certificate_orders',$11,true,$12) returning id`,
        [current.organization_id, current.company_id, current.share_group_id, (current.title ?? "Isännöitsijäntodistus").replace(/ \(luonnos\)$/, "") + " (sinetöity)",
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, Number(isoDateHelsinki().slice(0, 4)), orderId, userId],
      );
      const updated = await tx.query(
        "update er_certificate_orders set document_id = $2, sealed_at = now() where id = $1 and sealed_at is null and document_id = $3 returning id",
        [orderId, doc.id, current.document_id],
      );
      if (updated.length === 0) throw new CertificateError("Todistus muuttui sinetöinnin aikana. Tarkista tilaus ja yritä uudelleen.");
      await tx.query(
        `insert into er_signing_rounds (organization_id, company_id, subject_table, subject_id, status, signers, original_document_id, sealed_document_id,
                                        last_event, completed_at, created_by)
         values ($1,$2,'er_certificate_orders',$3,'completed','[]',$4,$5,'document.sealed',now(),$6)`,
        [current.organization_id, current.company_id, orderId, current.document_id, doc.id, userId],
      );
      // Sinetöity versio korvaa sinetöimättömän (RLS 0041: poisto pääkäyttäjä tai isännöitsijä).
      const deleted = await tx.query("delete from er_documents where id = $1 and not sealed returning id", [current.document_id]);
      if (deleted.length === 0) throw new CertificateError("Sinetöimättömän version poisto ei onnistunut. Sinetöinnin tekee pääkäyttäjä tai isännöitsijä.");
      await audit(tx, {
        organizationId: current.organization_id, userId, action: "seal_certificate", entity: "certificate_order", entityId: orderId,
        details: { documentId: doc.id, esinettiDocumentId: sealedMeta.id },
      });
      return doc.id;
    });
  } catch (err) {
    await remove(stored.storagePath);
    throw err;
  }
  // Tiedosto poistetaan vasta rivin poiston jälkeen (DECISIONS M4): epäonnistuminen jättää orvon tiedoston, ei rikkinäistä linkkiä.
  await remove(current.storage_path);
  return { documentId };
}
