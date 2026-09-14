import { describe, expect, it } from "vitest";
import { contractTiming, defaultReminderOn, noticeDeadline } from "@/lib/contracts/deadlines";
import { changePercent, monthlyTotals, sum } from "@/lib/consumption/aggregate";
import { parseConsumptionCsv, resolveCompany } from "@/lib/consumption/csv";

describe("sopimusten määräajat", () => {
  it("irtisanomisen viimeinen päivä ja muistutus", () => {
    expect(noticeDeadline("2026-12-31", 3)).toBe("2026-09-30");
    expect(noticeDeadline("2027-03-15", 1)).toBe("2027-02-15");
    expect(noticeDeadline("2026-12-31", null)).toBeNull();
    expect(noticeDeadline(null, 3)).toBeNull();
    expect(defaultReminderOn("2026-12-31", 3)).toBe("2026-08-31");
    expect(defaultReminderOn("2026-12-31", null)).toBe("2026-12-01");
    expect(defaultReminderOn(null, null)).toBeNull();
  });

  it("päättymässä 90 päivän sisällä", () => {
    const t = contractTiming({ ends_on: "2027-03-31", notice_months: 3, status: "active" }, "2026-11-15");
    expect(t.deadline).toBe("2026-12-31");
    expect(t.daysToDeadline).toBe(46);
    expect(t.endingSoon).toBe(true);
    expect(contractTiming({ ends_on: "2028-03-31", notice_months: 3, status: "active" }, "2026-11-15").endingSoon).toBe(false);
    const passed = contractTiming({ ends_on: "2027-01-31", notice_months: 6, status: "active" }, "2026-11-15");
    expect(passed.noticePassed).toBe(true);
    expect(passed.endingSoon).toBe(true);
    expect(contractTiming({ ends_on: "2026-01-31", notice_months: 1, status: "active" }, "2026-11-15").effectiveStatus).toBe("ended");
  });
});

describe("kulutuksen CSV", () => {
  it("suomalainen CSV otsikkorivillä", () => {
    const csv = [
      "Yhtiö;Laji;Alku;Loppu;Määrä;Yksikkö;Kustannus",
      "1234567-1;sähkö;1.1.2026;31.1.2026;1 234,5;kWh;210,40 €",
      "As Oy Testi A;Lämpö;2026-01-01;2026-01-31;12,3;MWh;",
      "As Oy Testi A;vesi;1.1.2026;31.1.2026;45;kWh;",
      "As Oy Testi A;vesi;31.1.2026;1.1.2026;45;m3;",
      "puuttuu",
    ].join("\r\n");
    const { rows, errors } = parseConsumptionCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ company: "1234567-1", utility: "electricity", periodStart: "2026-01-01", amount: 1234.5, unit: "kWh", costEur: 210.4 });
    expect(rows[1]).toMatchObject({ utility: "heat", unit: "MWh", costEur: null });
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6]);
  });

  it("yhtiö Y-tunnuksella tai nimellä", () => {
    const companies = [{ id: "a", name: "As Oy Testi A", business_id: "1234567-1" }];
    expect(resolveCompany("12345671", companies)?.id).toBe("a");
    expect(resolveCompany("as oy testi a", companies)?.id).toBe("a");
    expect(resolveCompany("Joku muu", companies)).toBeNull();
  });
});

describe("kulutuksen koonti", () => {
  it("jakso jaetaan kuukausille päivien suhteessa ja MWh muunnetaan kWh:ksi", () => {
    const { amount, cost } = monthlyTotals(
      [
        { period_start: "2026-01-01", period_end: "2026-01-31", amount: "1", unit: "MWh", cost_eur: "100" },
        { period_start: "2026-01-15", period_end: "2026-02-13", amount: 300, unit: "kWh" },
        { period_start: "2025-12-01", period_end: "2025-12-31", amount: 999, unit: "kWh" },
      ],
      2026,
    );
    expect(amount[0]).toBeCloseTo(1000 + 170);
    expect(amount[1]).toBeCloseTo(130);
    expect(sum(amount)).toBeCloseTo(1300);
    expect(cost[0]).toBeCloseTo(100);
  });

  it("vuosimuutos", () => {
    expect(changePercent(110, 100)).toBeCloseTo(10);
    expect(changePercent(10, 0)).toBeNull();
  });
});
