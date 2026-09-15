import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Keksityt liitetiedostot testeihin ja demodataan: pieni PDF, PNG-kuva,
 * suojatuksi merkitty ja rikkinäinen PDF. Ei oikeaa asiakasdataa.
 * Suhteellisilla importeilla, jotta myös scripts/seed-demo.mts voi käyttää tätä.
 */

export async function makePdf(pages: number, title = "Esimerkkiasiakirja"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${title} - sivu ${i + 1}/${pages}`, { x: 60, y: 760, size: 18, font, color: rgb(0.1, 0.16, 0.25) });
    page.drawText("Kuvitteellinen demoasiakirja. Ei oikeaa asiakasdataa.", { x: 60, y: 730, size: 11, font });
  }
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  return doc.save();
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Yksinkertainen RGB-PNG: vaalea tausta, tumma kehys ja "huoneiden" väliseinät (pohjakuvan tapainen). */
export function makePng(width: number, height: number): Uint8Array {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const wall = Math.abs(x - Math.floor(width * 0.55)) < 2 || (Math.abs(y - Math.floor(height * 0.5)) < 2 && x < width * 0.55);
      const v = border || wall ? 40 : 245;
      row[1 + x * 3] = v;
      row[2 + x * 3] = v;
      row[3 + x * 3] = border || wall ? 70 : 250;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

/** PDF, jonka trailerissa on salausviittaus: pdf-lib tulkitsee sen suojatuksi. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  // Ilman objektivirtoja trailer on tekstiä, johon salausviittauksen voi lisätä.
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const text = bytes.toString("latin1").replace(/trailer\s*<</, "trailer\n<<\n/Encrypt 1 0 R");
  return new Uint8Array(Buffer.from(text, "latin1"));
}

export function makeCorruptPdf(): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R >>\nrikki\n%%EOF", "latin1"));
}
