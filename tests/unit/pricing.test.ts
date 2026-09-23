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

  it("kuukausilaskutus on vuosimaksu ilman 10 %:n alennusta", () => {
    expect(cents(MONTHLY.base)).toBe(16.56);
    expect(cents(MONTHLY.perUnit)).toBe(1.67);
    expect(cents(MONTHLY.minimum)).toBe(27.67);
    expect(monthlyPrice(15, "yearly")).toBeCloseTo(monthlyPrice(15, "monthly") * 0.9, 6);
  });

  it("usean yhtiön yhteenveto ja vuosimaksun säästö", () => {
    const sum = priceSummary(10, 15, "yearly");
    expect(sum.perCompanyMonth).toBeCloseTo(37.4, 2);
    expect(sum.totalMonth).toBeCloseTo(374, 2);
    expect(sum.totalYear).toBeCloseTo(4488, 2);
    expect(sum.yearlySaving).toBeCloseTo((monthlyPrice(15, "monthly") - monthlyPrice(15, "yearly")) * 120, 4);
  });

  it("vuosimaksun hinnat ovat Jukan antamat", () => {
    expect(YEARLY_MONTHLY).toEqual({ base: 14.9, perUnit: 1.5, minimum: 24.9 });
  });
});
