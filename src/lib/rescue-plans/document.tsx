/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, readStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf, sha256Hex } from "@/documents/render";
import { EMERGENCY_SHEET_NUMBER, RescuePlan, type RescuePlanAttachment, type RescuePlanData } from "@/documents/RescuePlan";
import { inspectAttachment, MAX_MERGED_BYTES, mergeCertificatePdf, type MergeAttachment } from "@/lib/certificates/pdf-merge";
import { LEGAL_BASIS, RESCUE_PLAN_TEMPLATE_APPROVED } from "./content";
import { finalizeDraft, getPlan, listAttachmentCandidates, RescuePlanError, type PlanRow } from "./queries";

/**
 * Pelastussuunnitelman PDF: esikatselu luonnoksesta ja valmiin version
 * tallennus dokumentiksi. Liitteiksi valitut pohjapiirustukset yhdistetään
 * samaan PDF:ään (sama kokoaja kuin isännöitsijäntodistuksessa).
 */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface Loaded {
  plan: PlanRow;
  organizationName: string;
  businessId: string | null;
  attachments: { id: string; title: string; mime_type: string; size_bytes: string; storage_path: string }[];
}

async function load(tx: Sql, planId: string): Promise<Loaded | null> {
  const plan = await getPlan(tx, planId);
  if (!plan) return null;
  const [company] = await tx.query<{ business_id: string; org_name: string }>(
    "select c.business_id, o.name as org_name from er_housing_companies c join er_organizations o on o.id = c.organization_id where c.id = $1",
    [plan.company_id],
  );
  if (!company) return null;
  const candidates = await listAttachmentCandidates(tx, plan.company_id);
  const selected = plan.content.attachmentDocumentIds
    .map((id) => candidates.find((c) => c.id === id))
    .filter((c): c is (typeof candidates)[number] => Boolean(c));
  return { plan, organizationName: company.org_name, businessId: company.business_id, attachments: selected };
}

export async function renderPlanPdf(loaded: Loaded, opts: { issuedOn: string; read: (path: string) => Promise<Uint8Array> }): Promise<{ bytes: Uint8Array; sha256: string; warnings: string[] }> {
  const { plan } = loaded;
  // Liite 1 syntyy aina PDF:n mukana (toimintaohjeet hälytystilanteissa).
  const entries: RescuePlanAttachment[] = [
    { number: EMERGENCY_SHEET_NUMBER, title: "Toimintaohjeet hälytystilanteissa", pages: 1, status: "attached" },
  ];
  const merge: MergeAttachment[] = [];
  const warnings: string[] = [];
  for (const [index, a] of loaded.attachments.entries()) {
    const base = { number: index + 1 + EMERGENCY_SHEET_NUMBER, title: a.title, pages: null };
    if (Number(a.size_bytes) > MAX_ATTACHMENT_BYTES) {
      entries.push({ ...base, status: "failed", reason: "tiedosto on liian suuri" });
      warnings.push(`${a.title}: tiedosto on liian suuri liitettäväksi.`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await opts.read(a.storage_path);
    } catch {
      entries.push({ ...base, status: "failed", reason: "tiedostoa ei voitu lukea" });
      warnings.push(`${a.title}: tiedostoa ei voitu lukea.`);
      continue;
    }
    const inspected = await inspectAttachment(bytes, a.mime_type);
    if (!inspected.ok) {
      entries.push({ ...base, status: "failed", reason: inspected.reason });
      warnings.push(`${a.title}: ${inspected.reason}.`);
      continue;
    }
    entries.push({ ...base, status: "attached", pages: inspected.pages });
    merge.push({ bytes, kind: inspected.kind });
  }

  const data: RescuePlanData = {
    approved: RESCUE_PLAN_TEMPLATE_APPROVED,
    status: plan.status,
    organizationName: loaded.organizationName,
    businessId: loaded.businessId,
    version: plan.version,
    preparedOn: plan.prepared_on,
    nextReviewOn: plan.next_review_on,
    issuedOn: plan.prepared_on ?? opts.issuedOn,
    legalBasis: LEGAL_BASIS,
    content: plan.content,
    attachments: entries,
  };
  const pdf = await renderDocumentPdf(<RescuePlan data={data} />);
  if (merge.length === 0) return { bytes: pdf.bytes, sha256: pdf.sha256, warnings };
  const bytes = await mergeCertificatePdf({
    certificate: pdf.bytes,
    separators: null,
    attachments: merge,
    title: `Pelastussuunnitelma ${plan.content.companyName}`,
    issuedOn: data.issuedOn,
  });
  if (bytes.length > MAX_MERGED_BYTES) throw new RescuePlanError("Suunnitelma liitteineen on liian suuri (yli 25 Mt). Poista suurin liite.");
  return { bytes, sha256: sha256Hex(bytes), warnings };
}

const readBytes = async (path: string) => new Uint8Array(await readStoredFile(path));

/** Esikatselu luonnoksesta tai valmiista versiosta. Ei tallenna mitään. */
export async function previewPlanPdf(run: Runner, planId: string, companyId: string): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const loaded = await run((tx) => load(tx, planId));
  if (!loaded || loaded.plan.company_id !== companyId) return null;
  const pdf = await renderPlanPdf(loaded, { issuedOn: isoDateHelsinki(), read: readBytes });
  return { bytes: pdf.bytes, fileName: `pelastussuunnitelma-v${loaded.plan.version}${loaded.plan.status === "draft" ? "-luonnos" : ""}.pdf` };
}

/**
 * Tallentaa valmiin version: PDF renderöidään valmiina (ilman
 * luonnosmerkintää "ei vielä voimassa"), tiedosto tallennetaan ja kanta
 * päivitetään yhdessä transaktiossa. Epäonnistuessa tiedosto poistetaan.
 */
export async function finalizePlan(run: Runner, input: { planId: string; userId: string }): Promise<{ documentId: string; announcementId: string | null; warnings: string[] }> {
  const loaded = await run((tx) => load(tx, input.planId));
  if (!loaded) throw new RescuePlanError("Suunnitelmaa ei löytynyt.");
  if (loaded.plan.status !== "draft") throw new RescuePlanError("Versio on jo merkitty valmiiksi.");
  if (!loaded.plan.prepared_on || !loaded.plan.next_review_on) throw new RescuePlanError("Anna laatimispäivä ja seuraavan tarkistuksen päivä ja tallenna luonnos.");

  const finalView: Loaded = { ...loaded, plan: { ...loaded.plan, status: "final" } };
  const pdf = await renderPlanPdf(finalView, { issuedOn: isoDateHelsinki(), read: readBytes });
  const title = `Pelastussuunnitelma ${loaded.plan.content.companyName || ""} (versio ${loaded.plan.version})`.replace(/\s+/g, " ").trim();
  const stored = await storeFile({
    organizationId: loaded.plan.organization_id,
    companyId: loaded.plan.company_id,
    fileName: `pelastussuunnitelma-v${loaded.plan.version}-${loaded.plan.prepared_on}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
    maxBytes: MAX_MERGED_BYTES,
  });
  try {
    const result = await run((tx) =>
      finalizeDraft(tx, {
        planId: input.planId,
        userId: input.userId,
        document: { title, fileName: stored.fileName, storagePath: stored.storagePath, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
      }),
    );
    return { documentId: result.documentId, announcementId: result.announcementId, warnings: pdf.warnings };
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}
