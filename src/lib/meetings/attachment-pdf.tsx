/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { PDFDocument } from "pdf-lib";
import { renderDocumentPdf } from "@/documents/render";
import { MeetingAttachmentSeparators } from "@/documents/MeetingAttachmentSeparators";
import { appendAttachmentPages, inspectAttachment, MAX_MERGED_BYTES, type MergeAttachment } from "@/lib/certificates/pdf-merge";
import { readStoredFile } from "@/lib/storage";

/**
 * Pykälien liitteet esityslistan ja pöytäkirjan PDF:n loppuun (Jukka 22.9.2026).
 * Järjestys: asiakirja, sitten jokaisesta liitteestä erotinsivu ("Liite 8.1")
 * ja liitteen sivut. PDF liitetään sellaisenaan, PNG- ja JPEG-kuvat omalle
 * sivulleen. Muut tiedostot (Excel, Word, CSV, WebP) eivät mahdu PDF:ään: niistä tulee vain
 * erotinsivu, joka kertoo, mistä liitteen löytää. Pöytäkirja allekirjoitetaan
 * liitteineen, joten liitteet kuuluvat allekirjoitettuun asiakirjaan.
 */

export interface MeetingAttachmentFile {
  label: string;
  title: string;
  /** "8 § Lakimuutokset 2026–2027" */
  item: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

/** Yksittäinen liite, jota suurempaa ei yritetä liittää (sama kuin latauksen enimmäiskoko). */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class MeetingAttachmentPdfError extends Error {}

async function prepare(file: MeetingAttachmentFile, read: (path: string) => Promise<Uint8Array>): Promise<{ attachment: MergeAttachment; pages: number } | { failure: string }> {
  if (file.sizeBytes > MAX_ATTACHMENT_BYTES) return { failure: "tiedosto on liian suuri" };
  let bytes: Uint8Array;
  try {
    bytes = await read(file.storagePath);
  } catch {
    return { failure: "tiedostoa ei voitu lukea" };
  }
  const inspected = await inspectAttachment(bytes, file.mimeType);
  if (!inspected.ok) return { failure: inspected.reason };
  return { attachment: { bytes, kind: inspected.kind }, pages: inspected.pages };
}

export async function appendMeetingAttachments(opts: {
  document: Uint8Array;
  files: MeetingAttachmentFile[];
  documentLabel: "ESITYSLISTAN LIITE" | "PÖYTÄKIRJAN LIITE";
  companyName: string;
  meetingTitle: string;
  issuedOn: string;
  read?: (path: string) => Promise<Uint8Array>;
}): Promise<Uint8Array> {
  if (opts.files.length === 0) return opts.document;
  const read = opts.read ?? (async (p: string) => new Uint8Array(await readStoredFile(p)));
  const prepared: Awaited<ReturnType<typeof prepare>>[] = [];
  for (const file of opts.files) prepared.push(await prepare(file, read));

  const separators = await renderDocumentPdf(
    <MeetingAttachmentSeparators
      data={{
        documentLabel: opts.documentLabel,
        companyName: opts.companyName,
        meetingTitle: opts.meetingTitle,
        issuedOn: opts.issuedOn,
        items: opts.files.map((f, i) => {
          const p = prepared[i];
          return { label: f.label, title: f.title, item: f.item, pages: "pages" in p ? p.pages : null, failure: "failure" in p ? p.failure : null };
        }),
      }}
    />,
  );

  const out = await PDFDocument.create();
  const main = await PDFDocument.load(opts.document);
  for (const page of await out.copyPages(main, main.getPageIndices())) out.addPage(page);
  const sep = await PDFDocument.load(separators.bytes);
  for (const [i, p] of prepared.entries()) {
    const [page] = await out.copyPages(sep, [i]);
    out.addPage(page);
    if ("attachment" in p) await appendAttachmentPages(out, p.attachment);
  }

  // Aikaleimat asiakirjan päiväyksestä, jotta sama sisältö tuottaa samat tavut.
  const stamp = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(opts.issuedOn) ? opts.issuedOn : "2000-01-01"}T00:00:00.000Z`);
  out.setTitle(main.getTitle() ?? opts.meetingTitle);
  out.setAuthor("eRappu");
  out.setCreator("eRappu");
  out.setProducer("eRappu");
  out.setLanguage("fi");
  out.setCreationDate(stamp);
  out.setModificationDate(stamp);
  const bytes = await out.save({ useObjectStreams: true });
  if (bytes.length > MAX_MERGED_BYTES) {
    throw new MeetingAttachmentPdfError("Asiakirja liitteineen on liian suuri (yli 25 Mt). Pienennä tai poista suurin liite ja muodosta uudelleen.");
  }
  return bytes;
}
