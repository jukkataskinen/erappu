import { describe, expect, it } from "vitest";
import { monthlyPrice, priceSummary, MONTHLY, YEARLY_MONTHLY } from "@/content/pricing";

/** Hinnoittelu (Jukka 23.9.2026): vuosimaksu on 10 % kuukausilaskutusta halvempi. */
const cents = (v: number) => Math.round(v * 100) / 100;

describe("hinnoittelu", () => {
  it("vuosimaksu: perusmaksu ja huoneistot, vähintään minimi", () => {
    expect(monthlyPrice(15, "yearly")).toBeCloseTo(14.9 + 15 * 1.5, 2);
    // Pieni yhtiö jää minimiin: 14,90 + 3 × 1,50 = 19,40 < 24,90.
    expect(monthlyPrice(3, "yearly")).toBeCloseTo(24.9, 2);
  });

  it("kuukausilaskutuksen hinnat ovat Jukan antamat ja vuosimaksua kalliimmat", () => {
    expect(MONTHLY).toEqual({ base: 16.5, perUnit: 1.69, minimum: 27.95 });
    expect(cents(monthlyPrice(15, "monthly"))).toBe(41.85);
    expect(monthlyPrice(15, "monthly")).toBeGreaterThan(monthlyPrice(15, "yearly"));
  });

  it("usean yhtiön yhteenveto ja vuosimaksun säästö", () => {
    const sum = priceSummary(10, 15, "yearly");
    expect(sum.perCompanyMonth).toBeCloseTo(37.4, 2);
    expect(sum.totalMonth).toBeCloseTo(374, 2);
    expect(sum.totalYear).toBeCloseTo(4488, 2);
    // 10 yhtiötä × 12 kk × (41,85 − 37,40).
    expect(cents(sum.yearlySaving)).toBe(534);
  });

  it("vuosimaksun hinnat ovat Jukan antamat", () => {
    expect(YEARLY_MONTHLY).toEqual({ base: 14.9, perUnit: 1.5, minimum: 24.9 });
  });
});
