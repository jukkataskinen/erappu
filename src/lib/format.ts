/** Suomalaiset muotoilut käyttöliittymään ja asiakirjoihin. */

const dateFmt = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Helsinki" });
const dateTimeFmt = new Intl.DateTimeFormat("fi-FI", {
  day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki",
});
const eurFmt = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" });
const numFmt = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });

type DateLike = string | Date | null | undefined;

function toDate(value: DateLike): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: DateLike): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : "–";
}

export function formatDateTime(value: DateLike): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : "–";
}

export function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  return eurFmt.format(Number(value));
}

export function formatNumber(value: number | string | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === "") return "–";
  return unit ? `${numFmt.format(Number(value))} ${unit}` : numFmt.format(Number(value));
}

/**
 * Kannan date-sarake lomakkeen arvoksi (VVVV-KK-PP). pg ja PGlite palauttavat
 * date-sarakkeen Date-oliona paikallisena keskiyönä, joten toISOString
 * siirtäisi päivää taaksepäin Suomen aikavyöhykkeellä.
 */
export function toIsoDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value.slice(0, 10);
}

/** ISO-päivä (VVVV-KK-PP) Helsingin ajassa. */
export function isoDateHelsinki(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(date);
}

/** Omistusosuus murtolukuna: 1/2, tai "koko" kun 1/1. */
export function formatFraction(numerator: number, denominator: number): string {
  return numerator === denominator ? "koko" : `${numerator}/${denominator}`;
}
