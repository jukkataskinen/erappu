import { describe, expect, it } from "vitest";
import { addMonths, isoWeekNumber, startOfWeek } from "@/lib/tasks/dates";
import { describeRecurrence, nextOccurrence, normalizeRecurrence, type Recurrence } from "@/lib/tasks/recurrence";

function series(first: string, rule: Recurrence, count: number): string[] {
  const out = [first];
  while (out.length < count) out.push(nextOccurrence(out[out.length - 1], rule));
  return out;
}

describe("päivälaskenta", () => {
  it("kuukausien lisäys leikkaa kuun pituuteen", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-06-30", 6)).toBe("2026-12-30");
    expect(addMonths("2026-06-30", 6, { keepMonthEnd: true })).toBe("2026-12-31");
    expect(addMonths("2026-12-31", -3, { keepMonthEnd: true })).toBe("2026-09-30");
    expect(addMonths("2026-03-15", -15)).toBe("2024-12-15");
  });

  it("viikko alkaa maanantaista", () => {
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14");
    expect(startOfWeek("2026-09-14")).toBe("2026-09-14");
    expect(isoWeekNumber("2026-09-14")).toBe(38);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
  });
});

describe("toistuvuus", () => {
  it("kuukauden 31. päivä ei valu helmikuun jälkeen", () => {
    const rule = normalizeRecurrence({ freq: "monthly", interval: 1 }, "2026-01-31");
    expect(series("2026-01-31", rule, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("kuukauden viimeinen päivä (−1) karkausvuonna", () => {
    const rule: Recurrence = { freq: "monthly", interval: 1, by_month_day: -1 };
    expect(series("2028-01-31", rule, 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("karkauspäivän vuositehtävä palaa 29. päivään karkausvuonna", () => {
    const rule = normalizeRecurrence({ freq: "yearly", interval: 1 }, "2028-02-29");
    expect(series("2028-02-29", rule, 5)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  it("vuosittain kuun viimeinen päivä helmikuussa", () => {
    const rule = normalizeRecurrence({ freq: "yearly", interval: 1 }, "2027-02-28", { monthEnd: true });
    expect(rule.by_month_day).toBe(-1);
    expect(series("2027-02-28", rule, 2)).toEqual(["2027-02-28", "2028-02-29"]);
  });

  it("neljännesvuosittain ja viikoittain välillä", () => {
    const quarterly = normalizeRecurrence({ freq: "monthly", interval: 3 }, "2026-11-30");
    expect(series("2026-11-30", quarterly, 3)).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
    expect(series("2026-12-24", { freq: "weekly", interval: 2 }, 3)).toEqual(["2026-12-24", "2027-01-07", "2027-01-21"]);
  });

  it("kuvaus", () => {
    expect(describeRecurrence(null)).toBe("Ei toistu");
    expect(describeRecurrence({ freq: "yearly", interval: 1 })).toBe("Vuosittain");
    expect(describeRecurrence({ freq: "monthly", interval: 3 })).toBe("3 kuukauden välein");
  });
});
