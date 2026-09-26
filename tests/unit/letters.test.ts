import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fitLine, postalAddressLines } from "@/lib/letters/address";
import { buildLetterBatch } from "@/lib/letters/pdf";

describe("osoiterivit", () => {
  it("nimi, katuosoite ja postinumero toimipaikkoineen", () => {
    expect(postalAddressLines({ display_name: " Matti  Meikäläinen ", street_address: "Kotikatu 1 A 2", postal_code: "41660", city: "Toivakka", country: "FI" })).toEqual([
      "Matti Meikäläinen",
      "Kotikatu 1 A 2",
      "41660 Toivakka",
    ]);
  });

  it("ulkomaan osoitteeseen maa englanniksi isoin kirjaimin", () => {
    expect(postalAddressLines({ display_name: "Anna Svensson", street_address: "Storgatan 1", postal_code: "111 22", city: "Stockholm", country: "se" })?.[3]).toBe("SWEDEN");
  });

  it("puutteellinen osoite ei kelpaa kirjeeseen", () => {
    expect(postalAddressLines({ display_name: "Matti", street_address: "Kotikatu 1", postal_code: null, city: "Toivakka" })).toBeNull();
    expect(postalAddressLines({ display_name: "Matti", street_address: " ", postal_code: "41660", city: "Toivakka" })).toBeNull();
  });
});

describe("rivin sovitus osoitekenttään", () => {
  // Leveys = merkit × koko: helppo laskea käsin.
  const measure = (text: string, size: number) => text.length * size;

  it("mahtuva rivi säilyy täysikokoisena", () => {
    expect(fitLine("Matti", 100, { max: 10, min: 7 }, measure)).toEqual({ text: "Matti", size: 10 });
  });

  it("pitkä rivi pienennetään ensin", () => {
    // 12 merkkiä: 8 pt → 96 ≤ 100.
    expect(fitLine("Maija-Liisa ", 100, { max: 10, min: 7 }, measure)).toEqual({ text: "Maija-Liisa", size: 8 });
  });

  it("alarajalla rivi lyhennetään", () => {
    const fitted = fitLine("x".repeat(40), 70, { max: 10, min: 7 }, measure);
    expect(fitted.size).toBe(7);
    expect(fitted.text).toBe("x".repeat(10));
  });
});

async function appendixPdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

const content = { title: "Kutsu: varsinainen yhtiökokous", paragraphs: ["Kokouskutsu on liitteenä."], signature: ["Hallituksen puolesta"], footer: "Isännöinti A · As Oy Testi" };
const sender = ["As Oy Testi", "c/o Isännöinti A", "Toimistokatu 1", "40100 Jyväskylä"];

describe("kirjeiden PDF", () => {
  it("jokainen kirje on etusivu ja liite, ja kirjeet ovat yhtä pitkiä", async () => {
    const recipients = [
      { addressLines: ["Matti Meikäläinen", "Kotikatu 1 A 2", "41660 Toivakka"], reference: "Kohde: A 2" },
      { addressLines: ["Maija-Liisa Esimerkki-Pitkänimi-Vastaanottaja-Oy", "Esimerkkikatu 12 B 34", "19650 Joutsa"] },
      { addressLines: ["Anna Svensson", "Storgatan 1", "111 22 Stockholm", "SWEDEN"] },
    ];
    const { pdf, pagesPerLetter } = await buildLetterBatch({ sender, date: "2026-09-25", content, recipients, appendix: await appendixPdf(2) });
    expect(pagesPerLetter).toBe(3);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(9);
  });

  it("pitkä teksti jatkuu seuraavalle sivulle kaikissa kirjeissä samoin", async () => {
    const long = { ...content, paragraphs: Array.from({ length: 40 }, (_, i) => `Kappale ${i + 1}. ${"Tiedotteen tekstiä, joka jatkuu. ".repeat(6)}`) };
    const recipients = [
      { addressLines: ["A", "Katu 1", "00100 Helsinki"] },
      { addressLines: ["B", "Katu 2", "00100 Helsinki"] },
    ];
    const { pdf, pagesPerLetter } = await buildLetterBatch({ sender, date: "2026-09-25", content: long, recipients });
    expect(pagesPerLetter).toBeGreaterThan(1);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(pagesPerLetter * 2);
  });

  it("yli 12 sivun kirjettä ei tehdä", async () => {
    await expect(
      buildLetterBatch({ sender, date: "2026-09-25", content, recipients: [{ addressLines: ["A", "Katu 1", "00100 Helsinki"] }], appendix: await appendixPdf(12) }),
    ).rejects.toThrow(/enintään 12 sivua/);
  });

  it("koetuloste renderöityy yhdelle sivulle alueineen", async () => {
    const { pagesPerLetter } = await buildLetterBatch({ sender, date: "2026-09-25", content, recipients: [{ addressLines: ["A", "Katu 1", "00100 Helsinki"] }], calibration: true });
    expect(pagesPerLetter).toBe(1);
  });
});
