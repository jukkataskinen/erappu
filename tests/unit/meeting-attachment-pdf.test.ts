import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appendMeetingAttachments, type MeetingAttachmentFile } from "@/lib/meetings/attachment-pdf";

/** Pykälien liitteet esityslistan ja pöytäkirjan PDF:n loppuun. */

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

const file = (label: string, storagePath: string, mimeType = "application/pdf"): MeetingAttachmentFile => ({
  label, title: `${label} otsikko`, item: "8 § Lakimuutokset", storagePath, mimeType, sizeBytes: 100,
});

describe("liitteet asiakirjan loppuun", () => {
  it("lisää jokaisesta liitteestä erotinsivun ja liitteen sivut", async () => {
    const store: Record<string, Uint8Array> = { a: await pdf(2), b: await pdf(3) };
    const bytes = await appendMeetingAttachments({
      document: await pdf(1),
      files: [file("Liite 8.1", "a"), file("Liite 8.2", "b")],
      documentLabel: "ESITYSLISTAN LIITE",
      companyName: "As Oy Testi",
      meetingTitle: "Hallituksen kokous 24.9.2026",
      issuedOn: "2026-09-22",
      read: async (p) => store[p],
    });
    // 1 asiakirja + (1 + 2) + (1 + 3)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(8);
  });

  it("tiedostosta, jota ei voi liittää, tulee vain erotinsivu", async () => {
    const bytes = await appendMeetingAttachments({
      document: await pdf(1),
      files: [file("Liite 3.1", "x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), file("Liite 3.2", "missing")],
      documentLabel: "PÖYTÄKIRJAN LIITE",
      companyName: "As Oy Testi",
      meetingTitle: "Hallituksen kokous 24.9.2026",
      issuedOn: "2026-09-22",
      read: async (p) => {
        if (p === "x") return new TextEncoder().encode("PK ei pdf");
        throw new Error("ei löydy");
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it("ilman liitteitä asiakirja palautuu sellaisenaan", async () => {
    const doc = await pdf(1);
    expect(await appendMeetingAttachments({ document: doc, files: [], documentLabel: "ESITYSLISTAN LIITE", companyName: "x", meetingTitle: "x", issuedOn: "2026-09-22" })).toBe(doc);
  });
});
