import { describe, expect, it } from "vitest";
import { chargeStatement, chargeUsageText, fiscalPeriod, loanShareStatement, type LoanShareHolder } from "@/lib/finance/statements";

const period = fiscalPeriod("01-01", 2025);
const holder = (label: string, shares: number, over: Partial<LoanShareHolder> = {}): LoanShareHolder => ({
  shareGroupId: `g-${label}`, unitLabel: label, shareCount: shares, paidOffOn: null, paidOffEur: null, ...over,
});

describe("tilikausi", () => {
  it("kalenterivuosi ja poikkeava tilikausi", () => {
    expect(fiscalPeriod("01-01", 2025)).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(fiscalPeriod("07-01", 2025)).toEqual({ start: "2024-07-01", end: "2025-06-30" });
  });
});

describe("lainaosuuslaskelma", () => {
  it("osuudet osakkeiden suhteessa, kertasuoritus kesken tilikauden, summat täsmäävät", () => {
    const s = loanShareStatement(
      period,
      { openingBalanceEur: "100000.00", drawnEur: "0", amortizationEur: "7500.00", lumpSumEur: "24500.00", closingBalanceEur: "68000.00", interestEur: "2100.00" },
      [holder("A 1", 100), holder("A 2", 100, { paidOffOn: "2025-06-15", paidOffEur: "24500.00" }), holder("A 3", 200), holder("B 1", 100, { paidOffOn: "2023-12-31", paidOffEur: "30000" })],
    );
    expect(s.warnings).toEqual([]);
    const byUnit = Object.fromEntries(s.rows.map((r) => [r.unitLabel, [r.openingCents, r.lumpSumCents, r.amortizationCents, r.closingCents, r.paidBefore]]));
    // Alussa 100 000 € kolmelle (400 osaketta), lopussa 68 000 € kahdelle (300 osaketta).
    expect(byUnit["A 1"]).toEqual([2500000n, 0n, 233334n, 2266666n, false]);
    expect(byUnit["A 2"]).toEqual([2500000n, 2450000n, 50000n, 0n, false]);
    expect(byUnit["A 3"]).toEqual([5000000n, 0n, 466666n, 4533334n, false]);
    expect(byUnit["B 1"]).toEqual([0n, 0n, 0n, 0n, true]);
    expect(s.totals).toEqual({ openingCents: 10000000n, lumpSumCents: 2450000n, amortizationCents: 750000n, closingCents: 6800000n });
  });

  it("varoittaa saldojen ja kertasuoritusten erosta sekä puuttuvasta määrästä", () => {
    const s = loanShareStatement(
      period,
      { openingBalanceEur: "1000", drawnEur: "0", amortizationEur: "100", lumpSumEur: "0", closingBalanceEur: "800", interestEur: "0" },
      [holder("A 1", 1), holder("A 2", 1, { paidOffOn: "2025-03-01" })],
    );
    expect(s.warnings).toHaveLength(3);
    expect(s.warnings[0]).toContain("Saldot eivät täsmää");
    expect(s.warnings[2]).toContain("A 2");
  });
});

describe("jälkilaskelma", () => {
  const loans = [{ openingBalanceEur: "100000", drawnEur: "0", amortizationEur: "7500", lumpSumEur: "24500", closingBalanceEur: "68000", interestEur: "2100" }];

  it("rahoitusvastikkeet, käyttö ja siirto seuraavalle tilikaudelle", () => {
    const r = chargeStatement({ maintenanceIncomeEur: "52000", maintenanceExpensesEur: "49750.50", financingIncomeEur: "10000", interestFromFinancing: true, carriedInEur: "1200" }, loans);
    expect(r.maintenance).toEqual({ incomeCents: 5200000n, expensesCents: 4975050n, resultCents: 224950n });
    expect(r.financing).toMatchObject({ incomeCents: 1000000n, lumpSumCents: 2450000n, amortizationCents: 750000n, interestCents: 210000n, resultCents: 40000n, carriedOutCents: 160000n });
    const text = chargeUsageText(r, period);
    expect(text[0]).toContain("ylijäämää 2 249,50 €");
    expect(text[1]).toBe(
      "Rahoitusvastikkeita kertyi 10 000,00 € ja lainaosuuksien kertasuorituksia 24 500,00 €. Varoja käytettiin lainojen lyhennyksiin 7 500,00 €, kertasuorituksilla maksettuihin lainaosuuksiin 24 500,00 €, lainojen korkoihin 2 100,00 €.",
    );
    expect(text[2]).toBe("Käyttämättömiä rahoitusvastikkeita on 31.12.2025 yhteensä 1 600,00 €, josta edellisiltä tilikausilta siirtyneitä 1 200,00 €.");
  });

  it("korot hoitovastikkeesta ja vaje", () => {
    const r = chargeStatement({ maintenanceIncomeEur: null, maintenanceExpensesEur: null, financingIncomeEur: "7000", interestFromFinancing: false, carriedInEur: "0" }, loans);
    expect(r.maintenance).toBeNull();
    expect(r.financing).toMatchObject({ interestCents: 0n, resultCents: -50000n, carriedOutCents: -50000n });
    expect(chargeUsageText(r, period).at(-1)).toBe("Rahoitusvastikkeet eivät riittäneet lainojen hoitoon; vaje 31.12.2025 on 500,00 €.");
  });
});
