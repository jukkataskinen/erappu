import { z } from "zod";
import { addDays, parseIsoDate, startOfWeek, weekdayIndex, type IsoDate } from "@/lib/tasks/dates";

/**
 * Varausvuorot aukioloajoista, Europe/Helsinki.
 *
 * Aukioloajat ovat seinäkelloaikaa ("sauna 18–22"), joten vuorot lasketaan
 * paikallisena aikana ja muunnetaan UTC-hetkiksi vasta lopuksi. Kesäajan
 * vaihteessa:
 * - keväällä kello siirtyy 03:00 → 04:00: vuoroa, joka alkaisi olemattomana
 *   hetkenä, ei ole; olemattomaan hetkeen päättyvä vuoro päättyy vuoron
 *   pituuden jälkeen (UTC).
 * - syksyllä kello siirtyy 04:00 → 03:00: kahdesti esiintyvä hetki tulkitaan
 *   ensimmäiseksi (kesäaika), joten vuorot eivät mene päällekkäin eivätkä
 *   jätä aukkoa. Vaihteen yli menevä vuoro on tunnin pidempi.
 */

export const TIME_ZONE = "Europe/Helsinki";
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: "Maanantai", tue: "Tiistai", wed: "Keskiviikko", thu: "Torstai", fri: "Perjantai", sat: "Lauantai", sun: "Sunnuntai" };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export function timeToMinutes(t: string): number {
  if (!TIME.test(t)) throw new Error(`Virheellinen kellonaika: ${t}`);
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = minutes === 1440 ? 24 : Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes === 1440 ? 0 : m % 60).padStart(2, "0")}`;
}

const rangeSchema = z
  .tuple([z.string().regex(TIME), z.string().regex(TIME)])
  // zod ajaa tarkistuksen, vaikka muoto olisi jo virheellinen, joten ei heitetä tässä.
  .refine(([a, b]) => TIME.test(a) && TIME.test(b) && timeToMinutes(a) < timeToMinutes(b), "Aukioloajan alku on oltava ennen loppua.");

const dayRanges = z.array(rangeSchema).max(4).optional();
export const openHoursSchema = z.object({ mon: dayRanges, tue: dayRanges, wed: dayRanges, thu: dayRanges, fri: dayRanges, sat: dayRanges, sun: dayRanges });

export type OpenHours = Partial<Record<Weekday, [string, string][]>>;

export function parseOpenHours(value: unknown): OpenHours {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return {};
    }
  }
  const parsed = openHoursSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as OpenHours) : {};
}

/** "ma 18:00–22:00 · ti …" */
export function openHoursSummary(h: OpenHours): string {
  const parts = WEEKDAYS.filter((d) => h[d]?.length).map((d) => `${WEEKDAY_LABEL[d].slice(0, 2).toLowerCase()} ${h[d]!.map(([a, b]) => `${a}–${b}`).join(", ")}`);
  return parts.length ? parts.join(" · ") : "Ei aukioloaikoja";
}

const offsetFmt =new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Helsingin ajan ero UTC:hen minuutteina annetulla hetkellä (120 tai 180). */
export function helsinkiOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(offsetFmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * Paikallinen päivä + minuutit keskiyöstä → UTC-millisekunnit.
 * null, jos hetkeä ei ole (kevään siirto). Kahdesti esiintyvästä valitaan aiempi.
 */
export function helsinkiLocalToUtc(date: IsoDate, minutes: number): number | null {
  const { year, month, day } = parseIsoDate(date);
  const wall = Date.UTC(year, month - 1, day) + minutes * 60_000;
  const candidates = [180, 120].map((off) => wall - off * 60_000).filter((ms) => helsinkiOffsetMinutes(ms) === Math.round((wall - ms) / 60_000));
  return candidates.length ? Math.min(...candidates) : null;
}

/** UTC-hetki → Helsingin päivä ja kellonaika. */
export function utcToHelsinki(value: string | Date | number): { date: IsoDate; time: string } {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  const local = new Date(ms + helsinkiOffsetMinutes(ms) * 60_000);
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export interface Slot {
  date: IsoDate;
  startLocal: string;
  endLocal: string;
  startsAt: string;
  endsAt: string;
}

export function weekdayKey(date: IsoDate): Weekday {
  return WEEKDAYS[weekdayIndex(date)];
}

export function daySlots(date: IsoDate, openHours: OpenHours, slotMinutes: number): Slot[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes < 15) return [];
  const out: Slot[] = [];
  for (const [open, close] of openHours[weekdayKey(date)] ?? []) {
    const openMin = timeToMinutes(open);
    const closeMin = timeToMinutes(close);
    for (let s = openMin; s + slotMinutes <= closeMin; s += slotMinutes) {
      const start = helsinkiLocalToUtc(date, s);
      if (start === null) continue;
      const end = helsinkiLocalToUtc(date, s + slotMinutes) ?? start + slotMinutes * 60_000;
      if (end <= start) continue;
      out.push({
        date,
        startLocal: minutesToTime(s),
        endLocal: minutesToTime(s + slotMinutes),
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function weekSlots(anyDateInWeek: IsoDate, openHours: OpenHours, slotMinutes: number): { date: IsoDate; slots: Slot[] }[] {
  const monday = startOfWeek(anyDateInWeek);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, slots: daySlots(date, openHours, slotMinutes) };
  });
}

/** Etsii pyydetyn alkuhetken vuoron; muu kuin aukioloaikojen mukainen hetki → null. */
export function findSlot(startsAt: string, openHours: OpenHours, slotMinutes: number): Slot | null {
  const ms = new Date(startsAt).getTime();
  if (Number.isNaN(ms)) return null;
  const { date } = utcToHelsinki(ms);
  return daySlots(date, openHours, slotMinutes).find((s) => new Date(s.startsAt).getTime() === ms) ?? null;
}

/** Vakiovuoro: sama seinäkelloaika seuraavina viikkoina (kesäaika huomioiden). */
export function weeklySlots(first: Slot, weeks: number, openHours: OpenHours, slotMinutes: number): Slot[] {
  const out: Slot[] = [];
  for (let k = 0; k < weeks; k++) {
    const date = addDays(first.date, 7 * k);
    const match = daySlots(date, openHours, slotMinutes).find((s) => s.startLocal === first.startLocal);
    if (match) out.push(match);
  }
  return out;
}

export interface BusyInterval {
  starts_at: string | Date;
  ends_at: string | Date;
  mine: boolean;
  own_booking_id?: string | null;
}

export type SlotState = "free" | "busy" | "mine" | "past";

export function slotState(slot: Slot, busy: BusyInterval[], now: Date): { state: SlotState; bookingId: string | null } {
  const s = new Date(slot.startsAt).getTime();
  const e = new Date(slot.endsAt).getTime();
  const hit = busy.find((b) => new Date(b.starts_at).getTime() < e && new Date(b.ends_at).getTime() > s);
  if (hit) return { state: hit.mine ? "mine" : "busy", bookingId: hit.mine ? hit.own_booking_id ?? null : null };
  if (s < now.getTime()) return { state: "past", bookingId: null };
  return { state: "free", bookingId: null };
}
