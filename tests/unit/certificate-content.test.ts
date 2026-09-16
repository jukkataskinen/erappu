import { describe, expect, it } from "vitest";
import {
  asbestosNote, buildingSummary, chargePriceList, energyCertificateValidityNote, loanRow, ownershipShareText, parsePropertyCode, purposeText, rescuePlanText, spacesByKind, yesNo,
} from "@/lib/certificates/content";
import { availabilityEntries, type AttachmentCandidate } from "@/lib/certificates/attachments";

describe("isännöitsijäntodistuksen johdetut tiedot", () => {
  it("asbestihuomautus vain ennen vuotta 1994 valmistuneesta rakennuksesta", () => {
    expect(asbestosNote([{ completed_year: 2008 }, { completed_year: null }])).toBeNull();
    expect(asbestosNote([{ completed_year: 1994 }])).toBeNull();
    expect(asbestosNote([{ completed_year: 2008 }, { completed_year: 1979 }])).toContain("asbesti");
  });

  it("kiinteistötunnuksen osat", () => {
    expect(parsePropertyCode("179-15-1508-9")).toEqual({ municipality: "179", area: "15", group: "1508", unit: "9" });
    expect(parsePropertyCode("850-405-5-900")).toMatchObject({ group: "5", unit: "900" });
    expect(parsePropertyCode("M601")).toBeNull();
  });

  it("rakennusten yhteenveto ohittaa tuntemattomat arvot", () => {
    const s = buildingSummary([
      { apartment_area_m2: "450.0", floor_area_m2: null, volume_m3: "1800", staircases: 2, elevators: 0 },
      { apartment_area_m2: "344.5", floor_area_m2: null, volume_m3: null, staircases: null, elevators: 1 },
    ]);
    expect(s).toEqual({ count: 2, apartmentAreaM2: 794.5, floorAreaM2: null, volumeM3: 1800, staircases: 2, elevators: 1 });
  });

  it("tilaluettelo tyypeittäin ja yhtiön hallinnassa olevat", () => {
    const rows = spacesByKind([
      { kind: "parking", area_m2: null, share_count: 10, company_possession: false },
      { kind: "apartment", area_m2: "79.4", share_count: 79, company_possession: true },
      { kind: "apartment", area_m2: "54.5", share_count: 55, company_possession: false },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["apartment", "parking"]);
    expect(rows[0]).toMatchObject({ count: 2, shares: 134, companyPossession: 1 });
    expect(rows[0].areaM2).toBeCloseTo(133.9);
  });

  it("hinnasto ja lainan korko", () => {
    expect(chargePriceList([{ charge_type: "maintenance", label: null, basis: "area_m2", unit_price: "3.0000", vat_percent: "0" }])).toEqual([
      { product: "Hoitovastike", unitPrice: "3,00 €/m²/kk", vat: "" },
    ]);
    expect(chargePriceList([{ charge_type: "sauna", label: "Saunavuoro", basis: "fixed", unit_price: "12", vat_percent: "25.5" }])[0]).toEqual({
      product: "Saunavuoro", unitPrice: "12,00 €/kk", vat: "alv 25,5 %",
    });
    const l = loanRow({
      name: "Kattolaina", lender: "Pankki", loan_type: "capital_charge", principal_eur: "120000.00", balance_eur: "96000.00", balance_date: "2025-12-31",
      drawn_on: "2023-10-31", due_on: "2038-10-31", reference_rate: "Euribor 12 kk", margin_percent: "0.850", interest_percent: null, interest_terms: null,
      undrawn_eur: "10000", undrawn_estimated_on: "2027-01-01", purpose: "Vesikatto", allocated: true,
    });
    expect(l).toMatchObject({ type: "Pääomavastikelaina", interest: "Euribor 12 kk + 0,85 %", balance: "96 000 €", payable: "Kyllä", dueOn: "31.10.2038" });
    expect(l.undrawn).toBe("10 000 €, nostetaan arviolta 1.1.2027");
  });

  it("käyttötarkoitus ja kolmitilaiset arvot", () => {
    expect(purposeText("bank", null)).toBe("Pankkia varten");
    expect(purposeText("other", " Perunkirjoitus ")).toBe("Perunkirjoitus");
    expect(purposeText(null, "x")).toBeNull();
    expect(yesNo(null)).toBe("Ei tiedossa");
    expect(yesNo(false)).toBe("Ei");
  });

  it("ilman liitteitä -version luettelo kertoo saatavuuden", () => {
    const candidates: AttachmentCandidate[] = [
      { key: "articles", label: "Yhtiöjärjestys", document: { id: "1", title: "YJ", category: "articles", mimeType: "application/pdf", sizeBytes: 1, storagePath: "a", year: 2008, createdAt: "2026-01-01 10:00:00+00" } },
      { key: "budget", label: "Talousarvio", document: null },
    ];
    expect(availabilityEntries(candidates)).toEqual([
      { number: 1, key: "articles", label: "Yhtiöjärjestys", title: "YJ", dateText: "2008", pages: null, status: "available" },
      { number: 2, key: "budget", label: "Talousarvio", title: null, dateText: null, pages: null, status: "missing" },
    ]);
  });
});

describe("energiatodistuksen voimassaolo", () => {
  it("yli 10 vuotta vanha on vanhentunut, tasan 10 vuotta voi olla", () => {
    expect(energyCertificateValidityNote(2009, 2026)).toContain("vanhentunut");
    expect(energyCertificateValidityNote(2016, 2026)).toContain("voi olla jo vanhentunut");
    expect(energyCertificateValidityNote(2020, 2026)).toBeNull();
    expect(energyCertificateValidityNote(null, 2026)).toBeNull();
  });

  it("omistusosuus murtolukuna", () => {
    expect(ownershipShareText(1, 2)).toBe("1/2");
  });
});

describe("pelastussuunnitelma todistuksessa", () => {
  it("valmis suunnitelma, myöhästynyt tarkistus, asiakirja ja puuttuva", () => {
    expect(rescuePlanText({ prepared_on: "2026-03-01", next_review_on: "2027-03-01" }, null, "2026-09-16")).toBe(
      "Pelastussuunnitelma on laadittu 1.3.2026, seuraava tarkistus 1.3.2027.",
    );
    expect(rescuePlanText({ prepared_on: "2024-03-01", next_review_on: "2025-03-01" }, null, "2026-09-16")).toContain("myöhässä");
    expect(rescuePlanText(null, { year: 2019, created_at: "2026-09-14T21:00:00Z" }, "2026-09-16")).toContain("vuodelta 2019");
    expect(rescuePlanText(null, null, "2026-09-16")).toContain("ei ole kirjattu");
  });
});
