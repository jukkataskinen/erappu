import { createElement } from "react";
import { AttachmentSeparators } from "@/documents/AttachmentSeparators";
import { ManagerCertificate, type ManagerCertificateData } from "@/documents/ManagerCertificate";
import { renderDocumentPdf, sha256Hex } from "@/documents/render";
import { availabilityEntries, documentDateText, type AttachmentCandidate, type AttachmentEntry } from "./attachments";
import { inspectAttachment, MAX_MERGED_BYTES, mergeCertificatePdf, type MergeAttachment } from "./pdf-merge";

/**
 * Kokoaa valmiin todistuksen: ilman liitteitä pelkkä todistus, liitteineen
 * todistus + erotinsivut + liitteet samaan PDF:ään. Tiedostojen luku
 * annetaan funktiona, jotta kokoaminen on testattavissa ilman varastoa.
 */

export class CertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateError";
  }
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface AssembledCertificate {
  bytes: Uint8Array;
  sha256: string;
  entries: AttachmentEntry[];
  /** Laatijalle näytettävät varoitukset (puuttuva tai liittämättä jäänyt liite). Ei tiedostojen sisältöä. */
  warnings: string[];
}

export async function assembleCertificate(opts: {
  data: ManagerCertificateData;
  candidates: AttachmentCandidate[];
  excluded: string[];
  read: (storagePath: string) => Promise<Uint8Array>;
}): Promise<AssembledCertificate> {
  const { data } = opts;
  if (!data.order.withAttachments) {
    const entries = availabilityEntries(opts.candidates);
    const pdf = await renderDocumentPdf(createElement(ManagerCertificate, { data: { ...data, attachments: entries } }));
    return { bytes: pdf.bytes, sha256: pdf.sha256, entries, warnings: [] };
  }

  const entries: AttachmentEntry[] = [];
  const loaded: MergeAttachment[] = [];
  const warnings: string[] = [];
  let number = 0;
  // Liitteet käsitellään yksi kerrallaan, jotta muistissa on kerrallaan vain tarkistettava tiedosto ja jo hyväksytyt.
  for (const c of opts.candidates) {
    if (opts.excluded.includes(c.key)) continue;
    number += 1;
    const base = { number, key: c.key, label: c.label, title: c.document?.title ?? null, dateText: documentDateText(c.document), pages: null };
    if (!c.document) {
      entries.push({ ...base, status: "missing" });
      warnings.push(`${c.label}: ei saatavilla.`);
      continue;
    }
    if (c.document.sizeBytes > MAX_ATTACHMENT_BYTES) {
      entries.push({ ...base, status: "failed", reason: "tiedosto on liian suuri" });
      warnings.push(`${c.label}: tiedosto on liian suuri liitettäväksi.`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await opts.read(c.document.storagePath);
    } catch {
      entries.push({ ...base, status: "failed", reason: "tiedostoa ei voitu lukea" });
      warnings.push(`${c.label}: tiedostoa ei voitu lukea.`);
      continue;
    }
    const inspected = await inspectAttachment(bytes, c.document.mimeType);
    if (!inspected.ok) {
      entries.push({ ...base, status: "failed", reason: inspected.reason });
      warnings.push(`${c.label}: ${inspected.reason}.`);
      continue;
    }
    entries.push({ ...base, status: "attached", pages: inspected.pages });
    loaded.push({ bytes, kind: inspected.kind });
  }

  const certificate = await renderDocumentPdf(createElement(ManagerCertificate, { data: { ...data, attachments: entries } }));
  const attached = entries.filter((e) => e.status === "attached");
  const separators = attached.length
    ? await renderDocumentPdf(
        createElement(AttachmentSeparators, {
          data: {
            companyName: data.company.name,
            unitLabel: data.unit.label,
            issuedOn: data.issuedOn,
            draft: !data.approved,
            items: attached.map((e) => ({ number: e.number, label: e.label, title: e.title, dateText: e.dateText, pages: e.pages })),
          },
        }),
      )
    : null;
  const bytes = await mergeCertificatePdf({
    certificate: certificate.bytes,
    separators: separators?.bytes ?? null,
    attachments: loaded,
    title: `Isännöitsijäntodistus ${data.company.name} ${data.unit.label}`,
    issuedOn: data.issuedOn,
  });
  if (bytes.length > MAX_MERGED_BYTES) {
    throw new CertificateError("Todistus liitteineen on liian suuri (yli 25 Mt). Poista suurin liite valinnoista ja muodosta uudelleen.");
  }
  return { bytes, sha256: sha256Hex(bytes), entries, warnings };
}
