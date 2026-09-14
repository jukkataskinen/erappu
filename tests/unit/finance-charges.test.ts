import { describe, expect, it } from "vitest";
import {
  chargesForGroup,
  effectiveBasis,
  lineAmountCents,
  planBasisSuccession,
  type BillableGroup,
  type ChargeBasisInput,
} from "@/lib/finance/charges";
import { dueDateFor, monthPeriod, parseFiDate } from "@/lib/finance/dates";
import { centsToDecimal, parseScaled, roundDiv, toCents } from "@/lib/finance/money";
import { buildRunLines } from "@/lib/finance/billing";
import { primaryPayer } from "@/lib/finance/payers";

const basis = (over: Partial<ChargeBasisInput>): ChargeBasisInput => ({
  id: over.id ?? "b1",
  charge_type: "maintenance",
  label: null,
  basis: "area_m2",
  unit_price: "3.1500",
  vat_percent: "0.0",
  applies_to_kinds: null,
  starts_on: "2020-01-01",
  ends_on: null,
  ...over,
});

const apt: BillableGroup = { id: "g1", unit_label: "A 1", kind: "apartment", area_m2: "72.5", share_count: 725, resident_count: 2 };
const parking: BillableGroup = { id: "g2", unit_label: "AP 1", kind: "parking", area_m2: null, share_count: 0, resident_count: null };
const sep = monthPeriod("2026-09");

describe("rahalaskenta kokonaisluvuilla", () => {
  it("jäsentää desimaalit ja pyöristää puoli ylöspäin", () => {
    expect(parseScaled("3.15", 4)).toBe(31500n);
    expect(parseScaled("1 234,565", 2)).toBe(123457n);
    expect(parseScaled("-0,005", 2)).toBe(-1n);
    expect(toCents(12)).toBe(1200n);
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(centsToDecimal(-5n)).toBe("-0.05");
  });

  it("0,1 + 0,2 on täsmälleen 0,30", () => {
    expect(centsToDecimal(toCents("0.1") + toCents("0.2"))).toBe("0.30");
  });
});

describe("päivät", () => {
  it("kuukauden kausi ja eräpäivä", () => {
    expect(monthPeriod("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthPeriod("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(dueDateFor("2026-09-01", 5)).toBe("2026-09-05");
    expect(parseFiDate("5.9.2026")).toBe("2026-09-05");
    expect(parseFiDate("31.2.2026")).toBeNull();
  });
});

describe("vastikkeen laskenta", () => {
  it("hoitovastike €/m²/kk: 72,5 m² × 3,15 € = 228,38 €", () => {
    const r = chargesForGroup([basis({})], apt, sep);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amountCents).toBe(22838n); // 228,375 → 228,38
    expect(r.lines[0].quantity).toBe("72.5000");
    expect(r.lines[0].description).toContain("72,5 m² × 3,15 €/m²/kk");
  });

  it("osakeperuste €/osake/kk", () => {
    const r = chargesForGroup([basis({ charge_type: "financing", basis: "share", unit_price: "0.0123" })], apt, sep);
    expect(r.lines[0].amountCents).toBe(892n); // 725 × 0,0123 = 8,9175 → 8,92
  });

  it("kiinteä ja kappaleperuste", () => {
    const r = chargesForGroup(
      [basis({ id: "f", charge_type: "other", basis: "fixed", unit_price: "5" }), basis({ id: "u", charge_type: "sauna", basis: "unit", unit_price: "12.50" })],
      apt,
      sep,
    );
    expect(r.lines.map((l) => l.amountCents).sort()).toEqual([1250n, 500n].sort());
  });

  it("henkilöperuste asukasmäärästä, puuttuva määrä varoituksena", () => {
    const water = basis({ charge_type: "water", basis: "person", unit_price: "18" });
    expect(chargesForGroup([water], apt, sep).lines[0].amountCents).toBe(3600n);
    const r = chargesForGroup([water], parking, sep);
    expect(r.lines).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/asukasmäärä/);
  });

  it("applies_to_kinds rajaa huoneistotyypin", () => {
    const bases = [
      basis({ id: "m", applies_to_kinds: ["apartment", "commercial"] }),
      basis({ id: "p", charge_type: "parking", basis: "unit", unit_price: "15", applies_to_kinds: ["parking"] }),
    ];
    expect(chargesForGroup(bases, apt, sep).lines.map((l) => l.chargeBasisId)).toEqual(["m"]);
    expect(chargesForGroup(bases, parking, sep).lines.map((l) => l.chargeBasisId)).toEqual(["p"]);
  });

  it("puuttuva pinta-ala ei tuota riviä vaan varoituksen", () => {
    const r = chargesForGroup([basis({})], parking, sep);
    expect(r.lines).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/pinta-ala puuttuu/);
  });

  it("voimassa oleva peruste päivälle", () => {
    const bases = [basis({ id: "old", unit_price: "3.00", ends_on: "2026-08-31" }), basis({ id: "new", unit_price: "3.15", starts_on: "2026-09-01" })];
    expect(effectiveBasis(bases, "maintenance", "2026-08-31")?.id).toBe("old");
    expect(effectiveBasis(bases, "maintenance", "2026-09-01")?.id).toBe("new");
    expect(effectiveBasis(bases, "heating", "2026-09-01")).toBeNull();
  });

  it("peruste vaihtuu kuun alussa: vain uusi hinta", () => {
    const bases = [basis({ id: "old", unit_price: "3.00", ends_on: "2026-08-31" }), basis({ id: "new", unit_price: "3.15", starts_on: "2026-09-01" })];
    const r = chargesForGroup(bases, apt, sep);
    expect(r.lines.map((l) => l.chargeBasisId)).toEqual(["new"]);
    expect(r.lines[0].prorated).toBe(false);
  });

  it("peruste vaihtuu kesken kuun: molemmat päivien suhteessa", () => {
    const bases = [basis({ id: "old", unit_price: "3.00", ends_on: "2026-09-15" }), basis({ id: "new", unit_price: "3.30", starts_on: "2026-09-16" })];
    const r = chargesForGroup(bases, apt, sep);
    expect(r.lines.map((l) => l.chargeBasisId)).toEqual(["old", "new"]);
    // 72,5 × 3,00 × 15/30 = 108,75 ; 72,5 × 3,30 × 15/30 = 119,625 → 119,63
    expect(r.lines[0].amountCents).toBe(10875n);
    expect(r.lines[1].amountCents).toBe(11963n);
    expect(r.lines[0].prorated).toBe(true);
    expect(r.lines[1].description).toContain("16.9.2026–30.9.2026");
  });

  it("pyöristys tehdään vasta rivin lopuksi", () => {
    expect(lineAmountCents(parseScaled("0.5", 4), "0.0100")).toBe(1n); // 0,005 → 0,01
    expect(lineAmountCents(parseScaled("0.4", 4), "0.0100")).toBe(0n);
  });

  it("uusi peruste päättää saman vastikkeen edellisen", () => {
    const existing = [
      basis({ id: "a", starts_on: "2024-01-01", ends_on: null }),
      basis({ id: "p", charge_type: "maintenance", applies_to_kinds: ["parking"], starts_on: "2024-01-01" }),
      basis({ id: "h", charge_type: "heating", starts_on: "2024-01-01" }),
    ];
    const plan = planBasisSuccession(existing, { charge_type: "maintenance", applies_to_kinds: null, starts_on: "2026-10-01" });
    expect(plan.toEnd.map((b) => b.id)).toEqual(["a"]);
    expect(plan.endsOn).toBe("2026-09-30");
    expect(plan.conflicts).toEqual([]);
    const conflict = planBasisSuccession(existing, { charge_type: "heating", applies_to_kinds: null, starts_on: "2024-01-01" });
    expect(conflict.conflicts.map((b) => b.id)).toEqual(["h"]);
  });
});

describe("maksaja", () => {
  const own = (name: string, n: number, d: number, extra: Partial<{ starts_on: string | null; ends_on: string | null }> = {}) => ({
    party_id: name, display_name: name, share_numerator: n, share_denominator: d, starts_on: null, ends_on: null, ...extra,
  });

  it("suurin osuus, tasatilanteessa aakkosjärjestys", () => {
    expect(primaryPayer([own("Virtanen", 1, 3), own("Aalto", 2, 3)], "2026-09-01")?.party_id).toBe("Aalto");
    expect(primaryPayer([own("Öhman", 1, 2), own("Laine", 1, 2)], "2026-09-01")?.party_id).toBe("Laine");
    expect(primaryPayer([own("Laine", 1, 1, { ends_on: "2026-08-31" }), own("Uusi", 1, 1, { starts_on: "2026-09-01" })], "2026-09-01")?.party_id).toBe("Uusi");
    expect(primaryPayer([], "2026-09-01")).toBeNull();
  });
});

describe("laskutusajon rivit", () => {
  it("rivit osakeryhmittäin viitteineen ja summat", () => {
    const { lines, totals } = buildRunLines({
      period: sep,
      companyNumber: 12,
      bases: [basis({})],
      groups: [{ ...apt }, { ...apt, id: "g3", unit_label: "A 2", area_m2: "50.0" }],
      unitNumbers: new Map([["g1", 1], ["g3", 2]]),
      ownerships: [{ share_group_id: "g1", party_id: "p1", display_name: "Aalto", share_numerator: 1, share_denominator: 1, starts_on: null, ends_on: null, accounting_customer_no: null }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].referenceNumber).toBe("120016");
    expect(lines[1].payerPartyId).toBeNull();
    expect(totals.total_eur).toBe("385.88"); // 228,38 + 157,50
    expect(totals.missing_payer_count).toBe(1);
    expect(totals.warnings.join()).not.toContain("Aalto");
  });
});
