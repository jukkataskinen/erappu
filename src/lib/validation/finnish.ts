/**
 * Suomalaiset tunnisteet: henkilötunnus, Y-tunnus, IBAN, viitenumero,
 * kiinteistötunnus ja postinumero. Henkilötunnuksen ja Y-tunnuksen
 * tarkistukset on kopioitu Reilusopparista (src/lib/identity/finnish-id.ts).
 */

const CENTURIES: Record<string, number> = {
  "+": 1800, "-": 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900,
  A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000,
};
const CHECK_CHARACTERS = "0123456789ABCDEFHJKLMNPRSTUVWXY";

export function normalizeHetu(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

export function isValidHetu(value: string): boolean {
  const id = normalizeHetu(value);
  const m = /^(\d{2})(\d{2})(\d{2})([+\-A-FUVWXY])(\d{3})([0-9A-Y])$/.exec(id);
  if (!m) return false;
  const [, dd, mm, yy, sign, individual, check] = m;
  const year = CENTURIES[sign] + Number(yy);
  const date = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return false;
  const serial = Number(individual);
  if (serial < 2 || serial > 899) return false;
  return check === CHECK_CHARACTERS[Number(`${dd}${mm}${yy}${individual}`) % 31];
}

export function birthDateFromHetu(value: string): string | null {
  if (!isValidHetu(value)) return null;
  const id = normalizeHetu(value);
  return `${CENTURIES[id[6]] + Number(id.slice(4, 6))}-${id.slice(2, 4)}-${id.slice(0, 2)}`;
}

export function maskHetu(value: string): string {
  const id = normalizeHetu(value);
  return id.length === 11 ? `${id.slice(0, 7)}***${id.slice(10)}` : "•••";
}

export function normalizeBusinessId(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  return digits.length === 8 ? `${digits.slice(0, 7)}-${digits[7]}` : value.trim();
}

export function isValidBusinessId(value: string): boolean {
  const m = /^(\d{7})-(\d)$/.exec(normalizeBusinessId(value));
  if (!m) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((t, w, i) => t + w * Number(m[1][i]), 0);
  const r = sum % 11;
  if (r === 1) return false;
  return Number(m[2]) === (r === 0 ? 0 : 11 - r);
}

export function isValidPostalCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

/**
 * Kiinteistötunnus lyhyessä tai pitkässä muodossa: 172-402-4-543 tai
 * 17240200040543. Palauttaa lyhyen muodon tai null.
 */
export function normalizePropertyCode(value: string): string | null {
  const v = value.trim();
  const short = /^(\d{1,3})-(\d{1,3})-(\d{1,4})-(\d{1,4})(?:-[A-Z]\d{0,4})?$/.exec(v);
  if (short) return short.slice(1, 5).map((p) => String(Number(p))).join("-") + (v.match(/-[A-Z]\d{0,4}$/)?.[0] ?? "");
  const long = /^(\d{3})(\d{3})(\d{4})(\d{4})$/.exec(v.replace(/\s/g, ""));
  if (long) return long.slice(1, 5).map((p) => String(Number(p))).join("-");
  return null;
}

/** Kotimainen viitenumero: perusosa + tarkiste (painot 7-3-1 oikealta). */
export function referenceNumber(base: string): string {
  const digits = base.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 19) throw new Error("Viitenumeron perusosa on 3–19 numeroa");
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * weights[i % 3];
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits}${check}`;
}

export function isValidReferenceNumber(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{4,20}$/.test(digits)) return false;
  return referenceNumber(digits.slice(0, -1)) === digits;
}

/** RF-viite (ISO 11649) kotimaisesta viitteestä. */
export function rfReference(domestic: string): string {
  const digits = domestic.replace(/\D/g, "");
  const numeric = `${digits}271500`; // "RF00" → R=27 F=15 00
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  const check = String(98 - remainder).padStart(2, "0");
  return `RF${check}${digits}`;
}

/** Viite ryhmiteltynä viiden numeron ryhmiin näyttöä varten. */
export function formatReference(value: string): string {
  const d = value.replace(/\s/g, "");
  return d.replace(/\B(?=(\d{5})+(?!\d))/g, " ");
}

export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("FI") && iban.length !== 18) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
