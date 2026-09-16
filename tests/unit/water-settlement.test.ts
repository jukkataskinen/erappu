import { describe, expect, it } from "vitest";
import type { ChargeBasisInput } from "@/lib/finance/charges";
import {
  advanceParts,
  buildSettlementLines,
  meterSpan,
  monthlyAdvanceDescription,
  settlementAdvanceDescription,
  type WaterMeter,
} from "@/lib/water/settlement";
import { parseReading } from "@/lib/water/mutations";

const basis = (over: Partial<ChargeBasisInput>): ChargeBasisInput => ({
  id: "b-water", charge_type: "water", label: null, basis: "meter", unit_price: "5.5600", vat_percent: "0.0", applies_to_kinds: null, starts_on: "2024-01-01", ends_on: null,
  ...over,
});
const meter = (over: Partial<WaterMeter>): WaterMeter => ({
  id: "m1", share_group_id: "g1", kind: "cold", meter_number: null, installed_on: "2024-12-31", start_reading: "187", removed_on: null, final_reading: null,
  ...over,
});
const year = { start: "2026-01-01", end: "2026-12-31" };

describe("vesiennakot", () => {
  it("koko vuoden ennakko yhdistyy yhdeksi osaksi", () => {
    const parts = advanceParts([{ share_group_id: "g1", monthly_eur: "25.00", starts_on: "2025-06-01", ends_on: null }], "g1", year);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ start: "2026-01-01", end: "2026-12-31", fullMonths: 12, cents: 30000n });
    expect(settlementAdvanceDescription(parts[0])).toBe("Vesiennakot 1.1.2026–31.12.2026, 12 kk × 25,00 €");
  });

  it("ennakon muutos kesken vuotta ja osakuukausi päivien suhteessa", () => {
    const advances = [
      { share_group_id: "g1", monthly_eur: "20.00", starts_on: "2025-01-01", ends_on: "2026-06-15" },
      { share_group_id: "g1", monthly_eur: "30.00", starts_on: "2026-06-16", ends_on: null },
    ];
    const parts = advanceParts(advances, "g1", year);
    expect(parts.map((p) => [p.start, p.end, p.fullMonths, p.cents])).toEqual([
      ["2026-01-01", "2026-05-31", 5, 10000n],
      ["2026-06-01", "2026-06-15", null, 1000n],
      ["2026-06-16", "2026-06-30", null, 1500n],
      ["2026-07-01", "2026-12-31", 6, 18000n],
    ]);
  });

  it("kuukausilaskun rivin selite", () => {
    const period = { start: "2026-10-01", end: "2026-10-31" };
    const [part] = advanceParts([{ share_group_id: "g1", monthly_eur: "25", starts_on: "2026-01-01", ends_on: null }], "g1", period);
    expect(monthlyAdvanceDescription(part, period)).toBe("Vesiennakko 25,00 €/kk");
  });
});

describe("mittarin laskutettava väli", () => {
  it("ensimmäinen tasaus alkaa aloituslukemasta, seuraava edellisestä laskutetusta", () => {
    const m = meter({});
    const first = meterSpan(m, "2025-12-31", { value: "191", on: "2025-12-31" }, null);
    expect(first).toMatchObject({ ok: true, consumption: "4.000", start: { value: "187", on: "2024-12-31" } });
    const next = meterSpan(m, "2026-12-31", { value: "220.5", on: "2026-12-31" }, { value: "191.000", on: "2025-12-31" });
    expect(next).toMatchObject({ ok: true, consumption: "29.500" });
  });

  it("vaihdettu mittari laskutetaan loppulukemaan kerran", () => {
    const old = meter({ removed_on: "2026-05-10", final_reading: "200" });
    expect(meterSpan(old, "2026-12-31", null, { value: "191", on: "2025-12-31" })).toMatchObject({ ok: true, consumption: "9.000", end: { on: "2026-05-10" } });
    expect(meterSpan(old, "2027-12-31", null, { value: "200", on: "2026-05-10" })).toMatchObject({ ok: false, reason: "already_settled" });
  });

  it("puuttuva ja pienempi lukema", () => {
    expect(meterSpan(meter({}), "2026-12-31", null, null)).toMatchObject({ ok: false, reason: "missing_reading" });
    expect(meterSpan(meter({}), "2026-12-31", { value: "150", on: "2026-12-31" }, null)).toMatchObject({ ok: false, reason: "negative" });
  });
});

describe("tasauslasku", () => {
  const meters = [meter({ id: "c1" }), meter({ id: "h1", kind: "hot", start_reading: "57", meter_number: "H-12" })];
  const readings = new Map([
    ["c1", { value: "191", on: "2025-12-31" }],
    ["h1", { value: "58", on: "2025-12-31" }],
  ]);

  it("kylmä ja lämmin vesi omilla hinnoillaan, laskutusperusteena vanha ja uusi lukema", () => {
    const r = buildSettlementLines({
      period: { start: "2025-01-01", end: "2025-12-31" },
      roundDate: "2025-12-31",
      bases: [basis({}), basis({ id: "b-hot", charge_type: "hot_water", unit_price: "10.6200" })],
      groups: [{ id: "g1", unit_label: "A 6" }],
      meters,
      roundReadings: readings,
      lastBilled: new Map(),
      advances: [],
    });
    expect(r.warnings).toEqual([]);
    expect(r.lines.map((l) => [l.chargeType, l.description, l.amountCents])).toEqual([
      ["water", "Kylmä vesi: lukema 31.12.2024 187 → 31.12.2025 191 = 4 m³ × 5,56 €/m³", 2224n],
      ["hot_water", "Lämmin vesi, mittari H-12: lukema 31.12.2024 57 → 31.12.2025 58 = 1 m³ × 10,62 €/m³", 1062n],
    ]);
    expect(r.lines[1]).toMatchObject({ readingStart: { value: "57" }, readingEnd: { value: "58" }, lineNo: 2 });
  });

  it("ennakot miinusrivinä; ilman lämpimän veden hintaa käytetään vesimaksua", () => {
    const r = buildSettlementLines({
      period: { start: "2025-01-01", end: "2025-12-31" },
      roundDate: "2025-12-31",
      bases: [basis({})],
      groups: [{ id: "g1", unit_label: "A 6" }, { id: "g2", unit_label: "A 7" }],
      meters,
      roundReadings: readings,
      lastBilled: new Map(),
      advances: [{ share_group_id: "g1", monthly_eur: "5.00", starts_on: "2024-01-01", ends_on: null }],
    });
    const advance = r.lines.find((l) => l.chargeType === "water_advance")!;
    expect(advance).toMatchObject({ description: "Vesiennakot 1.1.2025–31.12.2025, 12 kk × 5,00 €", quantity: "12.0000", unitPrice: "-5.0000", amountCents: -6000n, lineNo: 3 });
    expect(r.lines[1]).toMatchObject({ chargeType: "water", amountCents: 556n });
    // 22,24 + 5,56 − 60,00 < 0 → hyvitys
    expect(r.creditGroups).toBe(1);
  });

  it("hinnan puuttuminen ja hinnanmuutos kauden aikana", () => {
    const input = {
      period: { start: "2025-01-01", end: "2025-12-31" }, roundDate: "2025-12-31", groups: [{ id: "g1", unit_label: "A 6" }],
      meters, roundReadings: readings, lastBilled: new Map(), advances: [],
    };
    expect(() => buildSettlementLines({ ...input, bases: [] })).toThrow("NO_WATER_PRICE");
    const r = buildSettlementLines({ ...input, bases: [basis({ ends_on: "2025-06-30" }), basis({ id: "b2", starts_on: "2025-07-01", unit_price: "6.0000" })] });
    expect(r.warnings[0]).toContain("hinta on muuttunut");
    expect(r.lines[0].unitPrice).toBe("6.0000");
  });
});

describe("lukeman syöttö", () => {
  it("hyväksyy pilkun ja välilyönnit, enintään kolme desimaalia", () => {
    expect(parseReading("1 234,5")).toBe("1234.5");
    expect(parseReading("191")).toBe("191");
    expect(parseReading("12,3456")).toBeNull();
    expect(parseReading("-1")).toBeNull();
  });
});

describe("lukeman järkevyystarkistus", () => {
  it("pienempi kuin edellinen, alle 2 m³ ja yli 500 m³ vaativat kuittauksen", async () => {
    const { readingIssues, issueText } = await import("@/lib/water/checks");
    expect(readingIssues("187", "191")).toEqual([]);
    expect(readingIssues("187", "186,5")).toEqual(["lower"]);
    expect(readingIssues("187", "188,999")).toEqual(["small"]);
    expect(readingIssues("187", "189")).toEqual([]);
    expect(readingIssues("187", "687")).toEqual([]);
    expect(readingIssues("187", "687,001")).toEqual(["large"]);
    expect(readingIssues(null, "5")).toEqual([]);
    expect(issueText("small", "187", "188")).toBe("Kulutus on vain 1 m³ edellisestä lukemasta. Onko lukema oikein?");
  });
});
