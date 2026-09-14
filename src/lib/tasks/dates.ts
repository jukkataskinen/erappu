/**
 * Kalenteripäivien laskenta ISO-merkkijonoina (VVVV-KK-PP).
 *
 * Eräpäivät ovat päiviä eivätkä hetkiä, joten ne lasketaan ilman aikavyöhykettä.
 * Date-olio paikallisessa ajassa siirtäisi päivää kesäajan vaihteessa tai
 * palvelimen UTC-ajassa.
 */

export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = ISO.exec(value);
  if (!m) throw new Error(`Virheellinen päivämäärä: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isLastDayOfMonth(date: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(date);
  return day === daysInMonth(year, month);
}

function toUtcMs(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

/** Päivien erotus b − a. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/**
 * Lisää kuukausia. Päivä leikataan kuukauden pituuteen (31.1. + 1 kk = 28.2.).
 * `keepMonthEnd`: kuukauden viimeisestä päivästä tulee viimeinen päivä
 * (30.6. + 6 kk = 31.12.), kuten lakien "kuuden kuukauden kuluessa
 * tilikauden päättymisestä" -määräajoissa.
 */
export function addMonths(date: IsoDate, months: number, opts: { keepMonthEnd?: boolean } = {}): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const index = year * 12 + (month - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  const last = daysInMonth(ny, nm);
  const nd = opts.keepMonthEnd && day === daysInMonth(year, month) ? last : Math.min(day, last);
  return toIsoDate(ny, nm, nd);
}

/** Viikonpäivä, maanantai = 0 … sunnuntai = 6. */
export function weekdayIndex(date: IsoDate): number {
  return (new Date(toUtcMs(date)).getUTCDay() + 6) % 7;
}

/** Viikon maanantai. */
export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}

/** ISO-viikkonumero. */
export function isoWeekNumber(date: IsoDate): number {
  const thursday = addDays(date, 3 - weekdayIndex(date));
  const { year } = parseIsoDate(thursday);
  return Math.floor(diffDays(toIsoDate(year, 1, 1), thursday) / 7) + 1;
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

const FI_MONTHS = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];
const FI_WEEKDAYS_SHORT = ["ma", "ti", "ke", "to", "pe", "la", "su"];

export function finnishMonthName(month: number): string {
  return FI_MONTHS[month - 1];
}

export function finnishWeekdayShort(date: IsoDate): string {
  return FI_WEEKDAYS_SHORT[weekdayIndex(date)];
}

/** 15.9. tai 15.9.2026 */
export function shortFinnishDate(date: IsoDate, withYear = false): string {
  const { year, month, day } = parseIsoDate(date);
  return withYear ? `${day}.${month}.${year}` : `${day}.${month}.`;
}
