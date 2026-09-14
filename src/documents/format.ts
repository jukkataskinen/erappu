/**
 * Suomalaiset muotoilut asiakirjoihin. Pohja Reilusopparista.
 *
 * Luvut muotoillaan käsin eikä `Intl.NumberFormat`illa: se käyttää kapeaa
 * sitomatonta välilyöntiä (U+202F) euromerkin edessä, ja se on PDF-fontissa
 * eri glyyfi kuin tavallinen välilyönti. Päivät ja kellonajat otetaan
 * Helsingin ajassa `formatToParts`illa ja kootaan itse samasta syystä.
 */

function helsinkiParts(value: string | Date): Record<string, string> | null {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

const WEEKDAYS: Record<string, string> = {
  Monday: "maanantai",
  Tuesday: "tiistai",
  Wednesday: "keskiviikko",
  Thursday: "torstai",
  Friday: "perjantai",
  Saturday: "lauantai",
  Sunday: "sunnuntai",
};

/** `1.9.2026`. Ei nollia edessä — niin päiväys kirjoitetaan suomeksi. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "–";
  // Pelkkä päivä (VVVV-KK-PP) luetaan sellaisenaan, jotta aikavyöhyke ei siirrä sitä.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return `${d}.${m}.${y}`;
  }
  const p = helsinkiParts(value);
  return p ? `${Number(p.day)}.${Number(p.month)}.${p.year}` : "–";
}

/** `tiistai 14.4.2027 klo 18.00` */
export function formatMeetingTime(value: string | Date): string {
  const p = helsinkiParts(value);
  if (!p) return "–";
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${WEEKDAYS[p.weekday] ?? ""} ${Number(p.day)}.${Number(p.month)}.${p.year} klo ${hour}.${p.minute}`.trim();
}

/** `850 €` tai `1 250,50 €`. Tuhaterotin on tavallinen välilyönti. */
export function formatEuro(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "" || Number.isNaN(Number(amount))) return "–";
  const rounded = Math.round(Number(amount) * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const [whole, cents] = abs.toFixed(hasCents ? 2 : 0).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}${cents ? `${grouped},${cents}` : grouped} €`;
}

/** Kokonaisluku tuhaterottimella: `12 345`. */
export function formatInteger(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return "–";
  return String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Pinta-ala: desimaalierotin on pilkku, eikä turhaa nollaa näytetä. 54.5 → "54,5 m²". */
export function formatArea(areaM2: number | string | null | undefined): string {
  if (areaM2 === null || areaM2 === undefined || areaM2 === "" || Number.isNaN(Number(areaM2))) return "–";
  const rounded = Math.round(Number(areaM2) * 10) / 10;
  return `${String(rounded).replace(".", ",")} m²`;
}

/** Tyhjä arvo viivaksi, jotta asiakirjaan ei jää tyhjää kohtaa, joka näyttää unohdukselta. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  const s = String(value).trim();
  return s === "" ? "–" : s;
}

/** `Maija ja Matti` — luettelo ihmisen tapaan. */
export function formatNames(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} ja ${clean[clean.length - 1]}`;
}

/** Osakevälit: `1–143, 200–210`. */
export function formatShareRanges(ranges: { first: number; last: number }[] | null | undefined): string {
  if (!ranges || ranges.length === 0) return "–";
  return ranges.map((r) => (r.first === r.last ? String(r.first) : `${r.first}–${r.last}`)).join(", ");
}
