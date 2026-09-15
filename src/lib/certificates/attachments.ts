import type { Sql } from "@/lib/db";
import { formatDate } from "@/documents/format";

/**
 * Isännöitsijäntodistuksen liitteet.
 *
 * Järjestys on kiinteä (Jukan päätös): yhtiöjärjestys, tilinpäätös
 * (sisältää toimintakertomuksen), talousarvio, huoneiston pohjakuva,
 * energiatodistus ja kunnossapitotarveselvitys. Kustakin luokasta käytetään
 * uusinta (vuosi, sitten tallennusaika). Kunnossapitotarveselvityksen
 * puuttuessa käytetään kunnossapitosuunnitelmaa, koska ennen luokan
 * `maintenance_needs_report` lisäämistä (0090) selvitykset tallennettiin
 * suunnitelmaluokkaan.
 */

export const ATTACHMENT_SLOTS = [
  { key: "articles", label: "Yhtiöjärjestys", categories: ["articles"], perUnit: false },
  { key: "financial_statement", label: "Tilinpäätös ja toimintakertomus", categories: ["financial_statement"], perUnit: false },
  { key: "budget", label: "Talousarvio", categories: ["budget"], perUnit: false },
  { key: "floor_plan", label: "Huoneiston pohjakuva", categories: ["floor_plan"], perUnit: true },
  { key: "energy_certificate", label: "Energiatodistus", categories: ["energy_certificate"], perUnit: false },
  { key: "maintenance_needs_report", label: "Kunnossapitotarveselvitys", categories: ["maintenance_needs_report", "maintenance_plan"], perUnit: false },
] as const;

export type AttachmentKey = (typeof ATTACHMENT_SLOTS)[number]["key"];
export const ATTACHMENT_KEYS = ATTACHMENT_SLOTS.map((s) => s.key) as AttachmentKey[];

export interface AttachmentCandidate {
  key: AttachmentKey;
  label: string;
  document: {
    id: string;
    title: string;
    category: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    year: number | null;
    createdAt: string;
  } | null;
}

/** Tallennettu liiteluettelon rivi (er_certificate_orders.attachments ja todistuksen liiteluettelo). */
export interface AttachmentEntry {
  number: number;
  key: AttachmentKey;
  label: string;
  title: string | null;
  /** Vuosi tai päivämäärä näyttömuodossa. */
  dateText: string | null;
  pages: number | null;
  /** attached = liitetty, missing = ei saatavilla, failed = ei voitu liittää, available = saatavilla isännöitsijältä (ilman liitteitä -versio). */
  status: "attached" | "missing" | "failed" | "available";
  reason?: string | null;
}

/**
 * Uusin dokumentti kustakin liiteluokasta. Ajetaan kutsujan transaktiossa,
 * joten RLS rajaa dokumentit. Yhtiön dokumenteista vain yhtiötason rivit
 * (ei huoneisto- tai kohdekohtaisia), pohjakuva huoneistolta.
 */
export async function findAttachmentCandidates(tx: Sql, companyId: string, shareGroupId: string): Promise<AttachmentCandidate[]> {
  const rows = await tx.query<{
    id: string; title: string; category: string; mime_type: string; size_bytes: string; storage_path: string; year: number | null; created_at: string; share_group_id: string | null;
  }>(
    `select id, title, category, mime_type, size_bytes::text, storage_path, year, created_at::text, share_group_id
       from er_documents
      where company_id = $1 and subject_table is null
        and ((share_group_id is null and category in ('articles', 'financial_statement', 'budget', 'energy_certificate', 'maintenance_needs_report', 'maintenance_plan'))
             or (share_group_id = $2 and category = 'floor_plan'))
      order by year desc nulls last, created_at desc`,
    [companyId, shareGroupId],
  );
  return ATTACHMENT_SLOTS.map((slot) => {
    let doc: (typeof rows)[number] | undefined;
    for (const category of slot.categories) {
      doc = rows.find((r) => r.category === category);
      if (doc) break;
    }
    return {
      key: slot.key,
      label: slot.label,
      document: doc
        ? { id: doc.id, title: doc.title, category: doc.category, mimeType: doc.mime_type, sizeBytes: Number(doc.size_bytes), storagePath: doc.storage_path, year: doc.year, createdAt: doc.created_at }
        : null,
    };
  });
}

export function documentDateText(doc: { year: number | null; createdAt: string } | null): string | null {
  if (!doc) return null;
  return doc.year ? String(doc.year) : formatDate(doc.createdAt.slice(0, 10));
}

/** Ilman liitteitä -version luettelo: mitä asiakirjoja isännöitsijältä on saatavilla. */
export function availabilityEntries(candidates: AttachmentCandidate[]): AttachmentEntry[] {
  return candidates.map((c, i) => ({
    number: i + 1,
    key: c.key,
    label: c.label,
    title: c.document?.title ?? null,
    dateText: documentDateText(c.document),
    pages: null,
    status: c.document ? "available" : "missing",
  }));
}

export function parseStoredEntries(value: unknown): AttachmentEntry[] {
  return Array.isArray(value) ? (value as AttachmentEntry[]).filter((e) => e && typeof e.number === "number" && typeof e.label === "string") : [];
}
