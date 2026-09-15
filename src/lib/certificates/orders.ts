import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import { queueMessage } from "@/lib/messaging";
import { deleteStoredFile, readStoredFile, storeFile } from "@/lib/storage";
import { loadManagerCertificateData } from "./manager-certificate";
import { assembleCertificate, CertificateError } from "./assemble";
import { ATTACHMENT_KEYS, findAttachmentCandidates } from "./attachments";
import { MAX_MERGED_BYTES } from "./pdf-merge";
import { CERTIFICATE_KIND, resolvePrices, type CertificatePriceSettings, type ResolvedPrices } from "./pricing";

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface OrderRow {
  id: string;
  company_id: string;
  company_name: string;
  share_group_id: string;
  unit_label: string;
  kind: string;
  orderer_name: string;
  orderer_email: string;
  orderer_phone: string | null;
  express: boolean;
  status: string;
  source: string;
  document_id: string | null;
  price_eur: string;
  created_at: string;
  delivered_at: string | null;
  with_attachments: boolean;
  excluded_attachments: string[];
  attachments: unknown;
  purpose: string | null;
  purpose_text: string | null;
  sealed_at: string | null;
}

const ORDER_SELECT = `
  select o.id, o.company_id, c.name as company_name, o.share_group_id, g.unit_label, o.kind, o.orderer_name, o.orderer_email, o.orderer_phone,
         o.express, o.status, o.source, o.document_id, o.price_eur, o.created_at, o.delivered_at, o.with_attachments, o.excluded_attachments,
         o.attachments, o.purpose, o.purpose_text, o.sealed_at::text
    from er_certificate_orders o
    join er_housing_companies c on c.id = o.company_id
    join er_share_groups g on g.id = o.share_group_id`;

export async function listOrders(tx: Sql, organizationId: string, opts: { openOnly?: boolean; companyId?: string; limit?: number } = {}): Promise<OrderRow[]> {
  const params: unknown[] = [organizationId];
  const where = ["o.organization_id = $1"];
  if (opts.openOnly) where.push("o.status in ('new', 'in_progress')");
  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`o.company_id = $${params.length}`);
  }
  params.push(opts.limit ?? 200);
  return tx.query<OrderRow>(
    `${ORDER_SELECT}
      where ${where.join(" and ")}
      order by case o.status when 'new' then 0 when 'in_progress' then 1 else 2 end, o.express desc, o.created_at desc
      limit $${params.length}`,
    params,
  );
}

/** Organisaation todistushinnat asetuksista (vakiot, jos asetuksia ei ole). */
export async function loadPrices(tx: Sql, organizationId: string): Promise<ResolvedPrices> {
  const [row] = await tx.query<{ prices: CertificatePriceSettings | null }>("select settings -> 'certificate_prices' as prices from er_organizations where id = $1", [organizationId]);
  return resolvePrices(row?.prices ?? null);
}

export async function getOrder(tx: Sql, orderId: string): Promise<OrderRow | null> {
  const [row] = await tx.query<OrderRow>(`${ORDER_SELECT} where o.id = $1`, [orderId]);
  return row ?? null;
}

export interface GeneratedCertificate {
  documentId: string;
  warnings: string[];
}

/**
 * Tekee todistuksen tilaukselle: PDF dokumentteihin (sisäinen näkyvyys,
 * osakeryhmään liitettynä) ja tilaus työn alle. Uusi versio korvaa
 * tilauksen dokumenttiviittauksen; vanha jää dokumentteihin historiaksi.
 * Liitteineen-tilauksessa liitteet yhdistetään samaan PDF:ään, ja
 * liiteluettelon tulos tallennetaan tilaukselle (`attachments`).
 * Sinetöityä todistusta ei muodosteta uudelleen.
 */
/** Varasto injektoitavana, jotta kulku voidaan testata ilman tiedostoja (kuten sopimuserissä). */
export interface CertificateStorageDeps {
  store?: typeof storeFile;
  remove?: typeof deleteStoredFile;
  read?: (storagePath: string) => Promise<Uint8Array>;
}

export async function generateCertificateForOrder(run: Runner, userId: string, orderId: string, deps: CertificateStorageDeps = {}): Promise<GeneratedCertificate | null> {
  const store = deps.store ?? storeFile;
  const remove = deps.remove ?? deleteStoredFile;
  const read = deps.read ?? (async (path: string) => new Uint8Array(await readStoredFile(path)));
  const loaded = await run(async (tx) => {
    const [order] = await tx.query<{
      organization_id: string; company_id: string; share_group_id: string; kind: string; status: string; purpose: string | null; purpose_text: string | null;
      orderer_name: string; with_attachments: boolean; excluded_attachments: string[]; sealed_at: string | null;
    }>(
      `select organization_id, company_id, share_group_id, kind, status, purpose, purpose_text, orderer_name, with_attachments, excluded_attachments, sealed_at
         from er_certificate_orders where id = $1`,
      [orderId],
    );
    if (!order || order.status === "cancelled") return null;
    if (order.sealed_at) throw new CertificateError("Todistus on jo sinetöity, eikä sitä muodosteta uudelleen. Tee tarvittaessa uusi tilaus.");
    const data = await loadManagerCertificateData(tx, order.share_group_id, {
      order: { purpose: order.purpose, purposeText: order.purpose_text, ordererName: order.orderer_name, withAttachments: order.with_attachments },
    });
    if (!data) return null;
    const candidates = await findAttachmentCandidates(tx, order.company_id, order.share_group_id);
    return { order, data, candidates };
  });
  if (!loaded) return null;

  const { order, data, candidates } = loaded;
  const assembled = await assembleCertificate({
    data,
    candidates,
    excluded: order.excluded_attachments ?? [],
    read,
  });
  const stored = await store({
    organizationId: order.organization_id,
    companyId: order.company_id,
    fileName: `isannoitsijantodistus${order.with_attachments ? "-liitteineen" : ""}-${data.unit.label}-${isoDateHelsinki()}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(assembled.bytes),
    maxBytes: MAX_MERGED_BYTES,
  });
  try {
    const documentId = await run(async (tx) => {
      const title = `${CERTIFICATE_KIND[order.kind] ?? "Todistus"}${order.with_attachments ? " liitteineen" : ""} ${data.unit.label}${data.approved ? "" : " (luonnos)"}`;
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                   visibility, year, subject_table, subject_id, uploaded_by)
         values ($1,$2,$3,'manager_certificate',$4,$5,$6,$7,$8,$9,'internal',$10,'er_certificate_orders',$11,$12) returning id`,
        [order.organization_id, order.company_id, order.share_group_id, title,
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, Number(isoDateHelsinki().slice(0, 4)), orderId, userId],
      );
      const updated = await tx.query(
        `update er_certificate_orders set document_id = $2, attachments = $3::jsonb, status = case when status = 'new' then 'in_progress' else status end
          where id = $1 and sealed_at is null returning id`,
        [orderId, doc.id, JSON.stringify(assembled.entries)],
      );
      if (updated.length === 0) throw new CertificateError("Todistus sinetöitiin muodostuksen aikana.");
      await audit(tx, {
        organizationId: order.organization_id, userId, action: "generate_certificate", entity: "certificate_order", entityId: orderId,
        details: { documentId: doc.id, withAttachments: order.with_attachments, attached: assembled.entries.filter((e) => e.status === "attached").length },
      });
      return doc.id;
    });
    return { documentId, warnings: assembled.warnings };
  } catch (err) {
    await remove(stored.storagePath);
    throw err;
  }
}

/**
 * Laatijan liitevalinnat: liitteineen/ilman ja poistetut liiteluokat.
 * Muutos ei koske sinetöityä tilausta.
 */
export async function saveOrderOptions(
  tx: Sql,
  userId: string,
  orderId: string,
  opts: { withAttachments: boolean; excluded: string[]; purpose: string | null; purposeText: string | null; price: number | null },
): Promise<boolean> {
  const excluded = opts.excluded.filter((k) => (ATTACHMENT_KEYS as string[]).includes(k));
  const rows = await tx.query<{ organization_id: string }>(
    `update er_certificate_orders set with_attachments = $2, excluded_attachments = $3, purpose = $4, purpose_text = $5, price_eur = coalesce($6, price_eur)
      where id = $1 and sealed_at is null and status in ('new', 'in_progress') returning organization_id`,
    [orderId, opts.withAttachments, excluded, opts.purpose, opts.purpose === "other" ? opts.purposeText : null, opts.price],
  );
  if (!rows[0]) return false;
  await audit(tx, { organizationId: rows[0].organization_id, userId, action: "update_options", entity: "certificate_order", entityId: orderId, details: { withAttachments: opts.withAttachments, excluded } });
  return true;
}

/**
 * Merkitsee tilauksen toimitetuksi ja jonoon viestin tilaajalle.
 *
 * Tilaaja ei ole kirjautunut eikä hänellä ole portaalitunnusta, joten
 * todistusta ei lähetetä liitteenä eikä latauslinkkinä: viesti kertoo, että
 * todistus toimitetaan. Toimitustapa on BLOCKERS-listalla.
 */
export async function markOrderDelivered(tx: Sql, userId: string, orderId: string): Promise<boolean> {
  const [order] = await tx.query<{ organization_id: string; orderer_email: string; kind: string; company_name: string; unit_label: string; document_id: string | null }>(
    `update er_certificate_orders o set status = 'delivered', delivered_at = now()
       from er_housing_companies c, er_share_groups g
      where o.id = $1 and c.id = o.company_id and g.id = o.share_group_id and o.status in ('new', 'in_progress')
      returning o.organization_id, o.orderer_email, o.kind, c.name as company_name, g.unit_label, o.document_id`,
    [orderId],
  );
  if (!order) return false;
  const kindLabel = CERTIFICATE_KIND[order.kind] ?? "Todistus";
  await queueMessage(tx, {
    organizationId: order.organization_id,
    recipient: order.orderer_email,
    subject: `${kindLabel}: ${order.company_name}, ${order.unit_label}`,
    body: [
      "Hei,",
      "",
      `tilaamasi ${kindLabel.toLowerCase()} (${order.company_name}, huoneisto ${order.unit_label}) on valmis. Isännöitsijä toimittaa todistuksen sinulle erikseen sovitulla tavalla.`,
      "",
      "Kiitos tilauksestasi.",
    ].join("\n"),
    subjectTable: "er_certificate_orders",
    subjectId: orderId,
  });
  await audit(tx, { organizationId: order.organization_id, userId, action: "deliver", entity: "certificate_order", entityId: orderId });
  return true;
}
