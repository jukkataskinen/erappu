import { describe, expect, it } from "vitest";
import { buildAnnualCycle, fiscalYearEnd, lastFiscalYearEnd } from "@/lib/tasks/annual-cycle";
import { nextOccurrence } from "@/lib/tasks/recurrence";

const byKey = (items: ReturnType<typeof buildAnnualCycle>) => Object.fromEntries(items.map((t) => [t.key, t]));

describe("tilikauden päättyminen", () => {
  it("kalenterivuosi ja heinäkuussa alkava tilikausi", () => {
    expect(fiscalYearEnd("01-01", 2025)).toBe("2025-12-31");
    expect(fiscalYearEnd("07-01", 2025)).toBe("2026-06-30");
    expect(fiscalYearEnd("03-01", 2027)).toBe("2028-02-29");
  });

  it("viimeisin päättynyt tilikausi", () => {
    expect(lastFiscalYearEnd("01-01", "2026-09-15")).toBe("2025-12-31");
    expect(lastFiscalYearEnd("01-01", "2025-12-31")).toBe("2025-12-31");
    expect(lastFiscalYearEnd("07-01", "2026-09-15")).toBe("2026-06-30");
    expect(lastFiscalYearEnd("07-01", "2026-06-29")).toBe("2025-06-30");
  });
});

describe("vakiovuosikello, tilikausi 01-01", () => {
  it("vuoden alussa kuluvan kierroksen määräajat", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-01-10" }));
    expect(t.financial_statement.due_on).toBe("2026-03-31");
    expect(t.audit.due_on).toBe("2026-04-30");
    expect(t.maintenance_needs.due_on).toBe("2026-04-30");
    expect(t.general_meeting.due_on).toBe("2026-06-30");
    expect(t.htj_update.due_on).toBe("2026-07-31");
    expect(t.insurance.due_on).toBe("2026-10-31");
    expect(t.budget.due_on).toBe("2026-11-30");
    expect(t.general_meeting.category).toBe("general_meeting");
    expect(t.general_meeting.recurrence).toEqual({ freq: "yearly", interval: 1, by_month: 6, by_month_day: -1 });
  });

  it("syyskuussa menneet siirtyvät seuraavaan kierrokseen", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-09-15" }));
    expect(t.financial_statement.due_on).toBe("2027-03-31");
    expect(t.general_meeting.due_on).toBe("2027-06-30");
    expect(t.htj_update.due_on).toBe("2027-07-31");
    expect(t.insurance.due_on).toBe("2026-10-31");
    expect(t.budget.due_on).toBe("2026-11-30");
  });

  it("tehtävät ovat eräpäivän mukaan järjestyksessä ja kaikki pohjat mukana", () => {
    const items = buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-01-10" });
    expect(items.map((i) => i.key).sort()).toEqual(
      ["audit", "budget", "energy_certificate", "financial_statement", "general_meeting", "htj_update", "insurance", "maintenance_needs"],
    );
    expect([...items].sort((a, b) => a.due_on.localeCompare(b.due_on)).map((i) => i.due_on)).toEqual(items.map((i) => i.due_on));
  });
});

describe("vakiovuosikello, tilikausi 07-01", () => {
  it("kuukauden viimeinen päivä säilyy (30.6. + 6 kk = 31.12.)", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "07-01", today: "2026-09-15" }));
    expect(t.financial_statement.due_on).toBe("2026-09-30");
    expect(t.audit.due_on).toBe("2026-10-31");
    expect(t.general_meeting.due_on).toBe("2026-12-31");
    expect(t.htj_update.due_on).toBe("2027-01-31");
    expect(t.insurance.due_on).toBe("2027-04-30");
    expect(t.budget.due_on).toBe("2027-05-31");
  });

  it("toistuva yhtiökokous pysyy kuun viimeisenä päivänä", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "07-01", today: "2026-09-15" }));
    expect(nextOccurrence(t.general_meeting.due_on, t.general_meeting.recurrence!)).toBe("2027-12-31");
  });
});

describe("energiatodistus", () => {
  it("todistuksen vuosi tiedossa: uusiminen puoli vuotta ennen, toistuu 10 vuoden välein", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-09-15", energyCertificateYear: 2018 }));
    expect(t.energy_certificate.due_on).toBe("2027-07-01");
    expect(t.energy_certificate.recurrence).toMatchObject({ freq: "yearly", interval: 10 });
    expect(nextOccurrence(t.energy_certificate.due_on, t.energy_certificate.recurrence!)).toBe("2037-07-01");
  });

  it("vanhentunut todistus erääntyy heti", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-09-15", energyCertificateYear: 2010 }));
    expect(t.energy_certificate.due_on).toBe("2026-09-15");
  });

  it("vuosi puuttuu: kertaluonteinen tarkistus", () => {
    const t = byKey(buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-01-10" }));
    expect(t.energy_certificate.recurrence).toBeNull();
    expect(t.energy_certificate.due_on).toBe("2026-02-28");
  });
});
