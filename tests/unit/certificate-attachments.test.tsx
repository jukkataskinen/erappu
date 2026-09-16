import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { ManagerCertificateData } from "@/documents/ManagerCertificate";
import { assembleCertificate, CertificateError } from "@/lib/certificates/assemble";
import type { AttachmentCandidate } from "@/lib/certificates/attachments";
import { inspectAttachment, mergeCertificatePdf } from "@/lib/certificates/pdf-merge";
import { orderPrice, resolvePrices } from "@/lib/certificates/pricing";
import { renderDocumentPdf } from "@/documents/render";
import { makeCorruptPdf, makeEncryptedPdf, makePdf, makePng } from "../helpers/pdf-fixtures";

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

const baseData: ManagerCertificateData = {
  approved: false,
  organizationName: "Isännöinti Testi Oy",
  issuedOn: "2026-09-15",
  verifyUrl: "https://app.esinetti.fi/verify",
  legalBasis: "AOYL 7:27 §",
  order: { purpose: "Kauppaa varten", ordererName: "Testi Tilaaja", withAttachments: true },
  company: {
    name: "As Oy Kuvitteellinen", businessId: "1234567-1", registeredOn: null, address: null, articlesDate: null, commercialRegisterNote: null,
    htjSynced: true, htjTransferredOn: null, boardChair: null, propertyMaintenance: null, totalShares: 100, sharesApartments: 100, sharesOther: 0,
    vat: "Ei", chargesDecidedBy: null, articlesMaintenanceClause: null, shareIssueAuthorization: null, articlesLawsuit: null, notes: null,
    shareCertificates: "–", energy: "–", rescuePlan: "Pelastussuunnitelma on laadittu 1.3.2026, seuraava tarkistus 1.3.2027.",
  },
  manager: { name: "Iida Isännöitsijä", email: null, phone: null, office: "Isännöinti Testi Oy", officeAddress: null, officePhone: null },
  properties: [],
  buildingSummary: { count: "0", apartmentArea: "–", floorArea: "–", volume: "–", staircases: "–", elevators: "0" },
  buildings: [],
  spaces: [],
  parking: { built: null, hall: null, other: null, company: null, rules: null },
  asbestosNote: null,
  unit: {
    label: "A 1", kindLabel: "Asuinhuoneisto", shareRanges: "1–100", shareCount: 100, votes: null, areaM2: "54.5", areaVerified: "Ei tiedossa", layout: null,
    floor: null, staircase: null, intendedUse: null, building: null, address: null, htjId: null, notes: null,
  },
  owners: { rows: [{ name: "Maija Meikäläinen", share: "1/1", since: "1.6.2020" }], source: "Omistajat yhtiön osakeluettelon mukaan." },
      possession: { companyPossession: "Ei", companyRented: "Ei", widowRight: "Ei tiedossa", spousesCommonHome: "Ei tiedossa", otherRestrictions: null, shortTermRental: "–" },
  renovationNotices: [],
  renovationNoticesSince: null,
  finance: { charges: [], monthlyTotal: null, priceList: [], loans: [], creditLimits: [], loanShare: [], paymentStatus: null, mortgages: [], mortgagesTotal: null, insurances: [] },
  repairs: { needsReportOn: null, planOn: null, planSummary: null, decided: [], done: [], planned: [] },
  restrictions: [],
  attachments: [],
};

function candidate(key: AttachmentCandidate["key"], label: string, path: string | null, mimeType = "application/pdf", sizeBytes = 1000): AttachmentCandidate {
  return {
    key,
    label,
    document: path ? { id: path, title: label, category: key, mimeType, sizeBytes, storagePath: path, year: 2025, createdAt: "2026-01-01 00:00:00+00" } : null,
  };
}

describe("liitteiden tarkistus", () => {
  it("tunnistaa PDF:n sivut, kuvan, suojatun ja rikkinäisen tiedoston", async () => {
    expect(await inspectAttachment(await makePdf(3), "application/pdf")).toEqual({ ok: true, kind: "pdf", pages: 3 });
    expect(await inspectAttachment(makePng(40, 20), "image/png")).toEqual({ ok: true, kind: "image", pages: 1 });
    expect(await inspectAttachment(await makeEncryptedPdf(), "application/pdf")).toEqual({ ok: false, reason: "PDF on suojattu" });
    expect((await inspectAttachment(makeCorruptPdf(), "application/pdf")).ok).toBe(false);
    expect(await inspectAttachment(new Uint8Array(Buffer.from("RIFF....WEBP")), "image/webp")).toEqual({ ok: false, reason: "kuvamuotoa ei voi liittää (vain PNG ja JPEG)" });
  });

  it("vaakakuva saa vaakasivun ja pystykuva pystysivun", async () => {
    const cert = await makePdf(1);
    const merged = await mergeCertificatePdf({
      certificate: cert, separators: null, title: "t", issuedOn: "2026-09-15",
      attachments: [{ bytes: makePng(300, 100), kind: "image" }, { bytes: makePng(100, 300), kind: "image" }],
    });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(3);
    const [, wide, tall] = doc.getPages();
    expect(wide.getWidth()).toBeGreaterThan(wide.getHeight());
    expect(tall.getHeight()).toBeGreaterThan(tall.getWidth());
  });
});

describe("todistuksen kokoaminen liitteineen", () => {
  it("sivumäärä = todistus + erotinsivu ja sivut jokaisesta liitetystä; puuttuva ja rikkinäinen eivät kaada", async () => {
    const files = new Map<string, Uint8Array>([
      ["yj.pdf", await makePdf(2)],
      ["tp.pdf", await makeEncryptedPdf()],
      ["pk.png", makePng(120, 80)],
      ["et.pdf", makeCorruptPdf()],
    ]);
    const candidates: AttachmentCandidate[] = [
      candidate("articles", "Yhtiöjärjestys", "yj.pdf"),
      candidate("financial_statement", "Tilinpäätös ja toimintakertomus", "tp.pdf"),
      candidate("budget", "Talousarvio", null),
      candidate("floor_plan", "Huoneiston pohjakuva", "pk.png", "image/png"),
      candidate("energy_certificate", "Energiatodistus", "et.pdf"),
      candidate("maintenance_needs_report", "Kunnossapitotarveselvitys", "puuttuu.pdf"),
    ];
    const result = await assembleCertificate({
      data: baseData,
      candidates,
      excluded: [],
      read: async (p) => {
        const f = files.get(p);
        if (!f) throw new Error("ei löydy");
        return f;
      },
    });
    expect(result.entries.map((e) => [e.number, e.key, e.status, e.pages])).toEqual([
      [1, "articles", "attached", 2],
      [2, "financial_statement", "failed", null],
      [3, "budget", "missing", null],
      [4, "floor_plan", "attached", 1],
      [5, "energy_certificate", "failed", null],
      [6, "maintenance_needs_report", "failed", null],
    ]);
    expect(result.entries[1].reason).toBe("PDF on suojattu");
    expect(result.warnings).toHaveLength(4);
    const certPages = (await renderDocumentPdf(
      // Sama data ja liiteluettelo kuin kokoamisessa, jotta todistuksen sivumäärä täsmää.
      (await import("react")).createElement((await import("@/documents/ManagerCertificate")).ManagerCertificate, { data: { ...baseData, attachments: result.entries } }),
    )).bytes;
    expect(await pageCount(result.bytes)).toBe((await pageCount(certPages)) + (1 + 2) + (1 + 1));
  });

  it("laatijan poistama liite jää pois luettelosta ja numerointi on juokseva", async () => {
    const result = await assembleCertificate({
      data: baseData,
      candidates: [candidate("articles", "Yhtiöjärjestys", "a"), candidate("budget", "Talousarvio", "b")],
      excluded: ["articles"],
      read: async () => makePdf(1),
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ number: 1, key: "budget", status: "attached" });
  });

  it("ilman liitteitä -versio on pelkkä todistus ja luettelo kertoo saatavuuden", async () => {
    const result = await assembleCertificate({
      data: { ...baseData, order: { ...baseData.order, withAttachments: false } },
      candidates: [candidate("articles", "Yhtiöjärjestys", "a"), candidate("budget", "Talousarvio", null)],
      excluded: [],
      read: async () => {
        throw new Error("ei saa lukea");
      },
    });
    expect(result.entries.map((e) => e.status)).toEqual(["available", "missing"]);
    expect(await pageCount(result.bytes)).toBeGreaterThanOrEqual(1);
  });

  it("liian suuri liite merkitään liittämättömäksi lukematta tiedostoa", async () => {
    const result = await assembleCertificate({
      data: baseData,
      candidates: [candidate("articles", "Yhtiöjärjestys", "a", "application/pdf", 21 * 1024 * 1024)],
      excluded: [],
      read: async () => {
        throw new Error("ei saa lukea");
      },
    });
    expect(result.entries[0]).toMatchObject({ status: "failed", reason: "tiedosto on liian suuri" });
    expect(CertificateError).toBeDefined();
  });
});

describe("hinnasto", () => {
  it("liitteineen oletuksena sama hinta, pikalisä erikseen", () => {
    const defaults = resolvePrices(null);
    expect(defaults).toEqual({ standard: 120, express: 180, withAttachments: 120 });
    expect(orderPrice(defaults, { express: false, withAttachments: true })).toBe(120);
    const custom = resolvePrices({ standard_eur: 130, express_eur: 190, with_attachments_eur: 160 });
    expect(orderPrice(custom, { express: true, withAttachments: true })).toBe(220);
    expect(orderPrice(custom, { express: false, withAttachments: false })).toBe(130);
  });
});
