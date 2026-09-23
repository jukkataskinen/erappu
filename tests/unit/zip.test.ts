import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, crc32, toCsv } from "@/lib/export/zip";

/** Lukee arkiston paikallisista otsakkeista: nimi, menetelmä ja sisältö. */
function readZip(zip: Buffer): { name: string; content: Buffer }[] {
  const out: { name: string; content: Buffer }[] = [];
  let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const method = zip.readUInt16LE(i + 8);
    const compressed = zip.readUInt32LE(i + 18);
    const uncompressed = zip.readUInt32LE(i + 22);
    const nameLen = zip.readUInt16LE(i + 26);
    const extraLen = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    const body = zip.subarray(start, start + compressed);
    const content = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(content.length).toBe(uncompressed);
    expect(crc32(content)).toBe(zip.readUInt32LE(i + 14));
    out.push({ name, content });
    i = start + compressed;
  }
  return out;
}

describe("zip-arkisto", () => {
  it("kirjoittaa tiedostot, jotka voi purkaa ja joiden tarkiste täsmää", () => {
    const teksti = Buffer.from("Ääkkösiä ja pitkää tekstiä ".repeat(50), "utf8");
    const kuva = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const zip = createZip([
      { name: "LUE-MINUT.txt", data: teksti },
      { name: "dokumentit/pöytäkirja.pdf", data: kuva },
    ]);

    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["LUE-MINUT.txt", "dokumentit/pöytäkirja.pdf"]);
    expect(files[0].content.toString("utf8")).toBe(teksti.toString("utf8"));
    expect(files[1].content).toEqual(kuva);
    // Keskushakemisto ja sen loppumerkintä ovat mukana.
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
  });

  it("samanniminen tiedosto ei korvaa edellistä", () => {
    const zip = createZip([
      { name: "dokumentit/liite.pdf", data: Buffer.from("eka") },
      { name: "dokumentit/liite.pdf", data: Buffer.from("toka") },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["dokumentit/liite.pdf", "dokumentit/liite-2.pdf"]);
    expect(files[1].content.toString()).toBe("toka");
  });

  it("polku ei karkaa arkistosta", () => {
    const files = readZip(createZip([{ name: "../../etc/passwd", data: Buffer.from("x") }]));
    expect(files[0].name).not.toContain("..");
  });
});

describe("csv", () => {
  it("puolipiste-erotin, BOM ja lainausmerkkien suojaus", () => {
    const csv = toCsv(["nimi", "huomio"], [["Asunto Oy Testi", 'Sisältää ; ja "lainausmerkit"'], ["Tyhjä", null]]).toString("utf8");
    expect(csv.startsWith("﻿")).toBe(true);
    const rivit = csv.replace("﻿", "").trimEnd().split("\r\n");
    expect(rivit[0]).toBe("nimi;huomio");
    expect(rivit[1]).toBe('Asunto Oy Testi;"Sisältää ; ja ""lainausmerkit"""');
    expect(rivit[2]).toBe("Tyhjä;");
  });
});
