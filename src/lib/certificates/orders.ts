import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import { queueMessage } from "@/lib/messaging";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { loadManagerCertificateData, renderManagerCertificate } from "./manager-certificate";
import { CERTIFICATE_KIND } from "./pricing";

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
}

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
    `select o.id, o.company_id, c.name as company_name, o.share_group_id, g.unit_label, o.kind, o.orderer_name, o.orderer_email, o.orderer_phone,
            o.express, o.status, o.source, o.document_id, o.price_eur, o.created_at, o.delivered_at
       from er_certificate_orders o
       join er_housing_companies c on c.id = o.company_id
       join er_share_groups g on g.id = o.share_group_id
      where ${where.join(" and ")}
      order by case o.status when 'new' then 0 when 'in_progress' then 1 else 2 end, o.express desc, o.created_at desc
      limit $${params.length}`,
    params,
  );
}

/**
 * Tekee todistuksen tilaukselle: PDF dokumentteihin (sisäinen näkyvyys,
 * osakeryhmään liitettynä) ja tilaus työn alle. Uusi versio korvaa
 * tilauksen dokumenttiviittauksen; vanha jää dokumentteihin historiaksi.
 */
export async function generateCertificateForOrder(run: Runner, userId: string, orderId: string): Promise<string | null> {
  const loaded = await run(async (tx) => {
    const [order] = await tx.query<{
      organization_id: string; company_id: string; share_group_id: string; kind: string; status: string; purpose: string | null; purpose_text: string | null;
      orderer_name: string; with_attachments: boolean;
    }>(
      "select organization_id, company_id, share_group_id, kind, status, purpose, purpose_text, orderer_name, with_attachments from er_certificate_orders where id = $1",
      [orderId],
    );
    if (!order || order.status === "cancelled") return null;
    const data = await loadManagerCertificateData(tx, order.share_group_id, {
      order: { purpose: order.purpose, purposeText: order.purpose_text, ordererName: order.orderer_name, withAttachments: false },
    });
    return data ? { order, data } : null;
  });
  if (!loaded) return null;

  const { order, data } = loaded;
  const pdf = await renderManagerCertificate(data);
  const stored = await storeFile({
    organizationId: order.organization_id,
    companyId: order.company_id,
    fileName: `isannoitsijantodistus-${data.unit.label}-${isoDateHelsinki()}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
  });
  try {
    return await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                   visibility, year, subject_table, subject_id, uploaded_by)
         values ($1,$2,$3,'manager_certificate',$4,$5,$6,$7,$8,$9,'internal',$10,'er_certificate_orders',$11,$12) returning id`,
        [order.organization_id, order.company_id, order.share_group_id, `${CERTIFICATE_KIND[order.kind] ?? "Todistus"} ${data.unit.label}${data.approved ? "" : " (luonnos)"}`,
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, Number(isoDateHelsinki().slice(0, 4)), orderId, userId],
      );
      await tx.query(
        "update er_certificate_orders set document_id = $2, status = case when status = 'new' then 'in_progress' else status end where id = $1",
        [orderId, doc.id],
      );
      await audit(tx, { organizationId: order.organization_id, userId, action: "generate_certificate", entity: "certificate_order", entityId: orderId, details: { documentId: doc.id } });
      return doc.id;
    });
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
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
