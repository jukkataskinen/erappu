import { z } from "zod";
import { addDays, daysInMonth, isLastDayOfMonth, parseIsoDate, toIsoDate, type IsoDate } from "./dates";

/**
 * Tehtävän toistuvuus. Tarkoituksella yksinkertainen (ei RRULEa): vuosittain,
 * kuukausittain tai viikoittain valitulla välillä.
 *
 * `by_month_day` tallennetaan tehtävää luotaessa, jotta 31. päivän
 * kuukausitehtävä ei ajan mittaan valu 28. päivään helmikuun jälkeen.
 * Arvo −1 tarkoittaa kuukauden viimeistä päivää.
 */
export const recurrenceSchema = z.object({
  freq: z.enum(["yearly", "monthly", "weekly"]),
  interval: z.number().int().min(1).max(120).default(1),
  by_month: z.number().int().min(1).max(12).optional(),
  by_month_day: z.number().int().min(-1).max(31).refine((v) => v !== 0).optional(),
});

export type Recurrence = z.infer<typeof recurrenceSchema>;

export const RECURRENCE_LABEL: Record<Recurrence["freq"], string> = {
  yearly: "vuosittain",
  monthly: "kuukausittain",
  weekly: "viikoittain",
};

export function describeRecurrence(r: Recurrence | null | undefined): string {
  if (!r) return "Ei toistu";
  const n = r.interval ?? 1;
  if (n === 1) return RECURRENCE_LABEL[r.freq][0].toUpperCase() + RECURRENCE_LABEL[r.freq].slice(1);
  const unit = r.freq === "yearly" ? "vuoden" : r.freq === "monthly" ? "kuukauden" : "viikon";
  return `${n} ${unit} välein`;
}

/** Täydentää säännön ensimmäisen eräpäivän perusteella. */
export function normalizeRecurrence(rule: Recurrence, firstDue: IsoDate, opts: { monthEnd?: boolean } = {}): Recurrence {
  const { month, day } = parseIsoDate(firstDue);
  const out: Recurrence = { freq: rule.freq, interval: rule.interval ?? 1 };
  if (rule.freq === "weekly") return out;
  const monthEnd = opts.monthEnd ?? false;
  out.by_month_day = rule.by_month_day ?? (monthEnd && isLastDayOfMonth(firstDue) ? -1 : day);
  if (rule.freq === "yearly") out.by_month = rule.by_month ?? month;
  return out;
}

function dayFor(year: number, month: number, byMonthDay: number): number {
  const last = daysInMonth(year, month);
  return byMonthDay === -1 ? last : Math.min(byMonthDay, last);
}

/** Seuraava eräpäivä annetun jälkeen. */
export function nextOccurrence(due: IsoDate, rule: Recurrence): IsoDate {
  const interval = rule.interval ?? 1;
  const { year, month, day } = parseIsoDate(due);
  switch (rule.freq) {
    case "weekly":
      return addDays(due, 7 * interval);
    case "monthly": {
      const index = year * 12 + (month - 1) + interval;
      const ny = Math.floor(index / 12);
      const nm = index - ny * 12 + 1;
      return toIsoDate(ny, nm, dayFor(ny, nm, rule.by_month_day ?? day));
    }
    case "yearly": {
      const ny = year + interval;
      const nm = rule.by_month ?? month;
      return toIsoDate(ny, nm, dayFor(ny, nm, rule.by_month_day ?? day));
    }
  }
}

/** Kannasta luettu jsonb → sääntö tai null, jos rikki. */
export function parseRecurrence(value: unknown): Recurrence | null {
  if (!value) return null;
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = recurrenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
