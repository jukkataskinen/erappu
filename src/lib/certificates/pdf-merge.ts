import { PDFDocument } from "pdf-lib";

/**
 * Todistuksen ja liitteiden yhdistäminen yhdeksi PDF:ksi (pdf-lib).
 *
 * Liite tarkistetaan (`inspectAttachment`) ennen todistuksen renderöintiä,
 * jotta liiteluetteloon saadaan sivumäärät ja rikkinäinen tai suojattu
 * tiedosto merkitään "Ei voitu liittää" kaatamatta koko muodostusta.
 * Kuvat (PNG, JPEG) sovitetaan omalle A4-sivulleen pysty- tai vaaka-asentoon
 * kuvan muodon mukaan.
 */

export const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const IMAGE_MARGIN = 36;

/** Sama kuin eSinetin sinetöitävän asiakirjan enimmäiskoko. Yhdistetty todistus sinetöidään, joten isompaa ei tehdä. */
export const MAX_MERGED_BYTES = 25 * 1024 * 1024;

export type InspectResult = { ok: true; kind: "pdf" | "image"; pages: number } | { ok: false; reason: string };

function looksLikePdf(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1").startsWith("%PDF");
}

function imageKind(bytes: Uint8Array): "png" | "jpg" | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 4).toString("latin1") === "\x89PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  return null;
}

/** Tarkistaa liitteen: PDF avautuu eikä ole salattu, kuva on PNG tai JPEG. Tyyppi päätellään sisällöstä. */
export async function inspectAttachment(bytes: Uint8Array, mimeType: string): Promise<InspectResult> {
  if (looksLikePdf(bytes)) {
    try {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = doc.getPageCount();
      if (pages === 0) return { ok: false, reason: "PDF-tiedostossa ei ole sivuja" };
      return { ok: true, kind: "pdf", pages };
    } catch (err) {
      // pdf-lib on käännetty ES5:ksi, jolloin `instanceof EncryptedPDFError` ei toimi; tunnistus viestistä.
      const encrypted = err instanceof Error && /encrypted/i.test(err.message);
      return { ok: false, reason: encrypted ? "PDF on suojattu" : "PDF-tiedosto on vioittunut" };
    }
  }
  const kind = imageKind(bytes);
  if (kind) {
    try {
      const probe = await PDFDocument.create();
      if (kind === "png") await probe.embedPng(bytes);
      else await probe.embedJpg(bytes);
      return { ok: true, kind: "image", pages: 1 };
    } catch {
      return { ok: false, reason: "kuvatiedosto on vioittunut" };
    }
  }
  return { ok: false, reason: mimeType.startsWith("image/") ? "kuvamuotoa ei voi liittää (vain PNG ja JPEG)" : "tiedostomuotoa ei voi liittää PDF:ään" };
}

export interface MergeAttachment {
  bytes: Uint8Array;
  kind: "pdf" | "image";
}

/**
 * Yhdistää: todistuksen sivut, sitten jokaisesta liitteestä erotinsivu ja
 * liitteen sivut. `separators` sisältää yhden sivun liitettä kohden samassa
 * järjestyksessä kuin `attachments`.
 */
export async function mergeCertificatePdf(opts: {
  certificate: Uint8Array;
  separators: Uint8Array | null;
  attachments: MergeAttachment[];
  title: string;
  issuedOn: string;
}): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const certificate = await PDFDocument.load(opts.certificate);
  for (const page of await out.copyPages(certificate, certificate.getPageIndices())) out.addPage(page);

  const separators = opts.separators ? await PDFDocument.load(opts.separators) : null;
  for (const [index, attachment] of opts.attachments.entries()) {
    if (separators && index < separators.getPageCount()) {
      const [sep] = await out.copyPages(separators, [index]);
      out.addPage(sep);
    }
    if (attachment.kind === "pdf") {
      const src = await PDFDocument.load(attachment.bytes, { updateMetadata: false });
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    } else {
      const image = imageKind(attachment.bytes) === "png" ? await out.embedPng(attachment.bytes) : await out.embedJpg(attachment.bytes);
      const landscape = image.width > image.height;
      const [pageW, pageH] = landscape ? [A4_PORTRAIT[1], A4_PORTRAIT[0]] : A4_PORTRAIT;
      const scale = Math.min((pageW - 2 * IMAGE_MARGIN) / image.width, (pageH - 2 * IMAGE_MARGIN) / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      const page = out.addPage([pageW, pageH]);
      page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    }
  }

  // Aikaleimat todistuksen päiväyksestä, jotta sama sisältö tuottaa samat tavut (ks. documents/render.ts).
  const stamp = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(opts.issuedOn) ? opts.issuedOn : "2000-01-01"}T00:00:00.000Z`);
  out.setTitle(opts.title);
  out.setAuthor("eRappu");
  out.setCreator("eRappu");
  out.setProducer("eRappu");
  out.setLanguage("fi");
  out.setCreationDate(stamp);
  out.setModificationDate(stamp);
  return out.save({ useObjectStreams: true });
}
