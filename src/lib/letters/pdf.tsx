/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Font } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { ensureDocumentFonts } from "@/documents/fonts";
import { renderDocumentPdf } from "@/documents/render";
import { FONT_FAMILY, weight } from "@/documents/theme";
import { ADDRESS_FIELD_WIDTH, ADDRESS_FONT, INFO_FIELD_WIDTH, SENDER_FONT, WindowLetter } from "@/documents/WindowLetter";
import { MAX_PAGES_PER_LETTER } from "@/lib/postita";
import { fitLine } from "./address";

/**
 * Kirjeet yhdeksi PDF:ksi Postitan `pdf_splitter`-jakoa varten: jokainen
 * kirje alkaa ikkunakirjeen etusivulla, ja sen perään tulee valinnainen
 * liite (kokouskutsu liitteineen). Postita jakaa PDF:n tasaväleihin, joten
 * kaikkien kirjeiden on oltava yhtä pitkiä; muuten osoitteet menisivät
 * vääriin kuoriin. Siksi pituudet tarkistetaan eikä oleteta.
 */

export interface LetterRecipient {
  addressLines: string[];
  reference?: string | null;
}

export interface LetterContent {
  title: string;
  paragraphs: string[];
  signature: string[];
  footer: string;
}

export class LetterPdfError extends Error {}

type FontData = { unitsPerEm: number; layout(text: string): { advanceWidth: number } };

/** Tekstin leveys pisteinä asiakirjojen fontilla. Fontit on ladattava ensin. */
function measurer(fontWeight: number): (text: string, size: number) => number {
  const source = (Font as unknown as { getFont(d: { fontFamily: string; fontWeight: number; fontStyle: string }): { data?: FontData | null } | null }).getFont({
    fontFamily: FONT_FAMILY,
    fontWeight,
    fontStyle: "normal",
  });
  const data = source?.data;
  // Varovainen arvio, jos fontin mittoja ei saada: leveämpi kuin todellinen, jolloin rivi pienenee mieluummin liikaa.
  if (!data?.layout) return (text, size) => text.length * size * 0.7;
  return (text, size) => (data.layout(text).advanceWidth / data.unitsPerEm) * size;
}

export async function buildLetterBatch(input: {
  sender: string[];
  date: string;
  content: LetterContent;
  recipients: LetterRecipient[];
  appendix?: Uint8Array | null;
  calibration?: boolean;
}): Promise<{ pdf: Uint8Array; pagesPerLetter: number }> {
  if (input.recipients.length === 0) throw new LetterPdfError("Ei kirjeitä muodostettavaksi.");
  await ensureDocumentFonts();
  const regular = measurer(weight.regular);
  const bold = measurer(weight.bold);
  const sender = input.sender.slice(0, 4).map((line, i) => fitLine(line, ADDRESS_FIELD_WIDTH, i === 0 ? { max: SENDER_FONT.max + 1, min: SENDER_FONT.min } : SENDER_FONT, i === 0 ? bold : regular));

  const out = await PDFDocument.create();
  out.setTitle(input.content.title);
  out.setCreator("eRappu");
  out.setProducer("eRappu");
  const stamp = new Date(`${input.date}T00:00:00.000Z`);
  out.setCreationDate(stamp);
  out.setModificationDate(stamp);

  const appendix = input.appendix ? await PDFDocument.load(input.appendix) : null;
  const appendixPages = appendix ? appendix.getPageIndices() : [];

  let pagesPerLetter: number | null = null;
  for (const r of input.recipients) {
    if (r.addressLines.length < 2 || r.addressLines.length > 4) throw new LetterPdfError("Osoitteessa on oltava 2–4 riviä.");
    const rendered = await renderDocumentPdf(
      <WindowLetter
        data={{
          sender,
          recipient: r.addressLines.map((line) => fitLine(line, ADDRESS_FIELD_WIDTH, ADDRESS_FONT, regular)),
          date: input.date,
          reference: r.reference ? fitLine(r.reference, INFO_FIELD_WIDTH, { max: 9, min: 6.5 }, regular) : null,
          ...input.content,
          calibration: input.calibration,
        }}
      />,
    );
    const cover = await PDFDocument.load(rendered.bytes);
    const pages = [...(await out.copyPages(cover, cover.getPageIndices()))];
    if (appendix) pages.push(...(await out.copyPages(appendix, appendixPages)));
    for (const p of pages) out.addPage(p);

    if (pagesPerLetter === null) pagesPerLetter = pages.length;
    else if (pagesPerLetter !== pages.length) throw new LetterPdfError("Kirjeiden sivumäärät poikkeavat toisistaan. Lyhennä kirjeen tekstiä.");
  }
  if (!pagesPerLetter || pagesPerLetter > MAX_PAGES_PER_LETTER) {
    throw new LetterPdfError(`Kirjeessä olisi ${pagesPerLetter} sivua. Postita postittaa enintään ${MAX_PAGES_PER_LETTER} sivua kirjettä kohden, joten jaa liitteet portaalissa.`);
  }
  return { pdf: await out.save(), pagesPerLetter };
}
