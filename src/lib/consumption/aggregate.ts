import { addMonths, diffDays, toIsoDate, type IsoDate } from "@/lib/tasks/dates";
import type { ConsumptionUnit } from "./labels";

/**
 * Kulutuksen kuukausi- ja vuosisummat.
 *
 * Lukemat ovat jaksoja, jotka eivät aina osu kalenterikuukausiin (esim.
 * 15.1.–14.2. tai koko vuoden lasku). Määrä jaetaan kuukausille päivien
 * suhteessa, jotta vuosivertailu on reilu.
 */

export interface ReadingLike {
  period_start: IsoDate;
  period_end: IsoDate;
  amount: number | string;
  unit: ConsumptionUnit;
  cost_eur?: number | string | null;
}

export function toCanonicalAmount(amount: number, unit: ConsumptionUnit): number {
  return unit === "MWh" ? amount * 1000 : amount;
}

/** Palauttaa vuoden 12 kuukauden summat (vertailuyksikössä) ja kustannukset. */
export function monthlyTotals(readings: ReadingLike[], year: number): { amount: number[]; cost: number[] } {
  const amount = Array<number>(12).fill(0);
  const cost = Array<number>(12).fill(0);
  for (const r of readings) {
    const total = diffDays(r.period_start, r.period_end) + 1;
    if (total <= 0) continue;
    const value = toCanonicalAmount(Number(r.amount), r.unit);
    const eur = r.cost_eur === null || r.cost_eur === undefined || r.cost_eur === "" ? 0 : Number(r.cost_eur);
    for (let m = 1; m <= 12; m++) {
      const monthStart = toIsoDate(year, m, 1);
      const monthEnd = addMonths(monthStart, 1);
      const from = r.period_start > monthStart ? r.period_start : monthStart;
      const lastDayOfMonth = toIsoDate(year, m, diffDays(monthStart, monthEnd));
      const to = r.period_end < lastDayOfMonth ? r.period_end : lastDayOfMonth;
      const days = diffDays(from, to) + 1;
      if (days <= 0) continue;
      amount[m - 1] += (value * days) / total;
      cost[m - 1] += (eur * days) / total;
    }
  }
  return { amount, cost };
}

export function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** Muutos prosentteina edelliseen; null, jos vertailukohtaa ei ole. */
export function changePercent(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
