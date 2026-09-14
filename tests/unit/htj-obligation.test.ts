import { describe, expect, it } from "vitest";
import { htj2Obligation } from "@/lib/htj/obligation";

describe("HTJ2-ilmoitusvelvollisuus", () => {
  it("yli viisi huoneistoa on pakollinen", () => {
    const o = htj2Obligation({ apartmentCount: 6, commercialCount: 0, loans: [] });
    expect(o.level).toBe("mandatory");
    expect(o.unitCount).toBe(6);
    expect(o.reasons[0]).toMatch(/6 huoneistoa/);
  });

  it("tasan viisi huoneistoa ilman lainaa on vapaaehtoinen", () => {
    const o = htj2Obligation({ apartmentCount: 5, commercialCount: 0, loans: [] });
    expect(o.level).toBe("voluntary");
    expect(o.reasons[0]).toMatch(/vapaaehtoista/);
  });

  it("liikehuoneistot lasketaan mukaan", () => {
    expect(htj2Obligation({ apartmentCount: 4, commercialCount: 2, loans: [] }).level).toBe("mandatory");
  });

  it("jaettava laina tekee pienestäkin yhtiöstä pakollisen", () => {
    const o = htj2Obligation({ apartmentCount: 4, commercialCount: 0, loans: [{ allocated: true, balanceEur: 8967 }] });
    expect(o.level).toBe("mandatory");
    expect(o.hasAllocatedLoan).toBe(true);
    expect(o.reasons.join(" ")).toMatch(/jaettava yhtiölaina/);
  });

  it("maksettu tai jakamaton laina ei tee velvolliseksi", () => {
    expect(htj2Obligation({ apartmentCount: 4, commercialCount: 0, loans: [{ allocated: true, balanceEur: 0 }] }).level).toBe("voluntary");
    expect(htj2Obligation({ apartmentCount: 4, commercialCount: 0, loans: [{ allocated: false, balanceEur: 50000 }] }).level).toBe("voluntary");
    expect(htj2Obligation({ apartmentCount: 4, commercialCount: 0, loans: [{ allocated: true, balanceEur: 1000, paidOff: true }] }).level).toBe("voluntary");
  });

  it("tuntematon saldo tulkitaan avoimeksi lainaksi", () => {
    expect(htj2Obligation({ apartmentCount: 2, commercialCount: 0, loans: [{ allocated: true, balanceEur: null }] }).level).toBe("mandatory");
  });

  it("molemmat perusteet näkyvät", () => {
    const o = htj2Obligation({ apartmentCount: 10, commercialCount: 0, loans: [{ allocated: true, balanceEur: 207500 }] });
    expect(o.reasons).toHaveLength(2);
  });
});
