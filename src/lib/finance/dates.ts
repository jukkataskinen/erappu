/**
 * Päivälaskenta ISO-päivillä (VVVV-KK-PP). Laskutuskausi on kalenteripäiviä,
 * joten kellonajat ja aikavyöhykkeet pidetään kokonaan poissa: päivä
 * käsitellään UTC-keskiyönä.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(value: string): number {
  if (!isIsoDate(value)) throw new Error(`Virheellinen päivä: ${value}`);
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return fromUtc(toUtc(value) + days * 86_400_000);
}

/** Päivien määrä välillä, molemmat päät mukaan. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Kuukauden laskutuskausi muodosta "2026-10". */
export function monthPeriod(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error("Kuukausi muodossa VVVV-KK");
  const start = `${m[1]}-${m[2]}-01`;
  const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1) };
}

/** Eräpäivä kauden kuukaudelle (päivä 1–28). */
export function dueDateFor(periodStart: string, dueDay: number): string {
  return `${periodStart.slice(0, 7)}-${String(Math.min(Math.max(dueDay, 1), 28)).padStart(2, "0")}`;
}

/** "1.9.2026" ilman aikavyöhykemuunnosta. */
export function fiDate(value: string | null | undefined): string {
  if (!value || !isIsoDate(value)) return "";
  return `${Number(value.slice(8, 10))}.${Number(value.slice(5, 7))}.${value.slice(0, 4)}`;
}

/** Suomalainen päivä (1.9.2026 tai 01.09.2026) tai ISO → ISO, muuten null. */
export function parseFiDate(value: string): string | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}
