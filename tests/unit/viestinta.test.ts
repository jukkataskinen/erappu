import { describe, expect, it } from "vitest";
import { detectAllowedType, sanitizeFileName } from "@/lib/storage";
import { isCronAuthorized } from "@/lib/announcements/cron";
import { buildRecipients, normalizeEmail } from "@/lib/announcements/recipients";
import { composeAnnouncementEmail, containsHetu } from "@/lib/announcements/content";
import { expectedFinancialStatementYear, missingBasicDocuments } from "@/lib/documents/basics";
import { normalizeDeclaredType, safeBackPath } from "@/lib/documents/queries";
import { isSameOriginRequest } from "@/lib/documents/http";

describe("tiedostovarasto", () => {
  it("sanitizeFileName poistaa polun ja erikoismerkit", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\Tilinpäätös 2025.pdf")).toBe("Tilinpäätös_2025.pdf");
    expect(sanitizeFileName("<b>lasku\"(1)*?.pdf")).toBe("blasku1.pdf");
    expect(sanitizeFileName("")).toBe("tiedosto");
    expect(sanitizeFileName("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
  });

  it("detectAllowedType tarkistaa sisällön eikä luota ilmoitettuun tyyppiin", () => {
    expect(detectAllowedType(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBe("application/pdf");
    expect(detectAllowedType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image/png")).toBe("image/png");
    expect(detectAllowedType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe("image/jpeg");
    expect(detectAllowedType(Buffer.from("<html>"), "application/pdf")).toBeNull();
    expect(detectAllowedType(Buffer.from("MZ\x90\x00"), "application/x-msdownload")).toBeNull();
    expect(detectAllowedType(Buffer.from("<svg/>"), "image/svg+xml")).toBeNull();
    expect(detectAllowedType(Buffer.from("a;b\n1;2"), "text/csv")).toBe("text/csv");
  });

  it("CSV:n tyyppi päätellään päätteestä, kun selain ilmoittaa Excel-tyypin", () => {
    expect(normalizeDeclaredType("vastikkeet.CSV", "application/vnd.ms-excel")).toBe("text/csv");
    expect(normalizeDeclaredType("kuva.png", "")).toBe("image/png");
    expect(normalizeDeclaredType("x.pdf", "application/pdf")).toBe("application/pdf");
    expect(normalizeDeclaredType("x.exe", "")).toBe("");
  });

  it("paluupolku sallii vain dokumenttisivut", () => {
    expect(safeBackPath("/dokumentit")).toBe("/dokumentit");
    expect(safeBackPath("/taloyhtiot/0e6f1a3c-1111-4222-8333-944455556666/dokumentit")).toBe("/taloyhtiot/0e6f1a3c-1111-4222-8333-944455556666/dokumentit");
    expect(safeBackPath("https://evil.example/dokumentit")).toBe("/dokumentit");
    expect(safeBackPath("//evil.example")).toBe("/dokumentit");
    expect(safeBackPath("/dokumentit/../kirjaudu")).toBe("/dokumentit");
    expect(safeBackPath(null)).toBe("/dokumentit");
  });

  it("alkuperätarkistus hylkää vieraan ja puuttuvan Originin", () => {
    expect(isSameOriginRequest(new Headers({ origin: "https://erappu.fi", host: "erappu.fi" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "https://evil.example", host: "erappu.fi" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ host: "erappu.fi" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ origin: "null", host: "erappu.fi" }))).toBe(false);
  });
});

describe("ajastetun lähetyksen suojaus", () => {
  it("tuotannossa vaaditaan oikea Bearer-salaisuus", () => {
    const env = { CRON_SECRET: "salainen-arvo-123", NODE_ENV: "production" };
    expect(isCronAuthorized("Bearer salainen-arvo-123", env)).toBe(true);
    expect(isCronAuthorized("Bearer väärä", env)).toBe(false);
    expect(isCronAuthorized("salainen-arvo-123", env)).toBe(false);
    expect(isCronAuthorized(null, env)).toBe(false);
    expect(isCronAuthorized("Bearer salainen-arvo-1234", env)).toBe(false);
  });

  it("tuotannossa ilman salaisuutta reitti on kiinni", () => {
    expect(isCronAuthorized(null, { NODE_ENV: "production" })).toBe(false);
    expect(isCronAuthorized("Bearer ", { CRON_SECRET: "", NODE_ENV: "production" })).toBe(false);
  });

  it("kehityksessä ilman salaisuutta ajo sallitaan, salaisuuden kanssa se vaaditaan", () => {
    expect(isCronAuthorized(null, { NODE_ENV: "development" })).toBe(true);
    expect(isCronAuthorized(null, { CRON_SECRET: "x", NODE_ENV: "development" })).toBe(false);
  });
});

describe("tiedotteen vastaanottajat", () => {
  it("yksi viesti osoitetta kohden, roolit yhdistetään", () => {
    const r = buildRecipients([
      { party_id: "p1", role: "owner", email: "Matti@Example.test ", user_id: "u1" },
      { party_id: "p1", role: "board", email: "Matti@Example.test ", user_id: "u1" },
      { party_id: "p2", role: "owner", email: "matti@example.test", user_id: null },
      { party_id: "p3", role: "resident", email: "ei-osoite", user_id: "u3" },
      { party_id: "p4", role: "resident", email: null, user_id: null },
      { party_id: "p5", role: "resident", email: "liisa@example.test", user_id: null },
    ]);
    expect(r.partyCount).toBe(5);
    expect(r.emailRecipients).toEqual([
      { email: "matti@example.test", partyId: "p1", roles: ["owner", "board"] },
      { email: "liisa@example.test", partyId: "p5", roles: ["resident"] },
    ]);
    expect(r.withoutEmailCount).toBe(2);
    expect(r.portalUserCount).toBe(2);
  });

  it("normalizeEmail hylkää virheelliset", () => {
    expect(normalizeEmail(" A@B.fi ")).toBe("a@b.fi");
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("tiedotteen sisältö", () => {
  it("tunnistaa kelvollisen henkilötunnuksen tekstistä", () => {
    expect(containsHetu("Osakkaan tunnus 131052-308T, ota yhteyttä")).toBe(true);
    expect(containsHetu("Tilausnumero 131052-308X")).toBe(false);
    expect(containsHetu("Saunavuorot tiistaisin 18-21")).toBe(false);
  });

  it("sähköpostissa on otsikko, teksti ja portaalilinkki", () => {
    const m = composeAnnouncementEmail({ companyName: "As Oy Testi", title: "Vesikatko", body: "Vesi katkaistaan.", validUntil: "2026-10-01", portalUrl: "https://x.test/portaali/tiedotteet/1" });
    expect(m.subject).toBe("As Oy Testi: Vesikatko");
    expect(m.body).toContain("Vesi katkaistaan.");
    expect(m.body).toContain("1.10.2026");
    expect(m.body).toContain("https://x.test/portaali/tiedotteet/1");
  });
});

describe("perusdokumentit", () => {
  it("odotettu tilinpäätösvuosi vaihtuu heinäkuussa", () => {
    expect(expectedFinancialStatementYear(new Date(2026, 5, 30))).toBe(2024);
    expect(expectedFinancialStatementYear(new Date(2026, 6, 1))).toBe(2025);
  });

  it("puuttuvat ja vanhentuneet perusdokumentit", () => {
    const today = new Date(2026, 8, 15);
    expect(missingBasicDocuments([], today).map((m) => m.category)).toEqual(["articles", "financial_statement", "energy_certificate"]);
    const ok = missingBasicDocuments(
      [
        { category: "articles", year: null },
        { category: "financial_statement", year: 2025 },
        { category: "energy_certificate", year: 2019 },
      ],
      today,
    );
    expect(ok).toEqual([]);
    const stale = missingBasicDocuments(
      [
        { category: "articles", year: 2008 },
        { category: "financial_statement", year: 2024 },
        { category: "energy_certificate", year: 2014 },
      ],
      today,
    );
    expect(stale.map((m) => m.reason)).toEqual(["Tilinpäätös 2025 puuttuu.", "Energiatodistus (2014) on vanhentunut."]);
  });
});
