/**
 * Rahalaskenta kokonaisluvuilla.
 *
 * Kanta palauttaa numeric-arvot merkkijonoina, ja ne muunnetaan tässä
 * kiinteän desimaalimäärän kokonaisluvuiksi (BigInt). Liukuluvuilla
 * 0,1 + 0,2 ei ole 0,3, ja kuukausittain toistuvassa vastikelaskussa
 * senttivirheet kertautuisivat.
 */

/** Desimaaliluku ("1234.5", "1 234,50", 12) kokonaisluvuksi annetulla desimaalimäärällä. Pyöristää puoli ylöspäin. */
export function parseScaled(value: string | number | bigint, scale: number): bigint {
  if (typeof value === "bigint") return value * 10n ** BigInt(scale);
  const text = (typeof value === "number" ? numberToPlain(value) : value)
    .replace(/[\s ]/g, "")
    .replace(",", ".");
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`Virheellinen luku: ${value}`);
  const negative = m[1] === "-";
  const intPart = m[2] || "0";
  const frac = m[3] ?? "";
  const kept = frac.slice(0, scale).padEnd(scale, "0");
  let n = BigInt(intPart) * 10n ** BigInt(scale) + BigInt(kept || "0");
  // Pyöristys ensimmäisen poisjäävän numeron mukaan.
  if (frac.length > scale && Number(frac[scale]) >= 5) n += 1n;
  return negative ? -n : n;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error("Virheellinen luku");
  return n.toFixed(10);
}

/** Jakolasku kokonaisluvuilla, pyöristys puoli poispäin nollasta (kaupallinen pyöristys). */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Jako nollalla");
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const q = (a * 2n + b) / (2n * b);
  return negative ? -q : q;
}

/** Euromäärä sentteinä. */
export function toCents(value: string | number): bigint {
  return parseScaled(value, 2);
}

/** Sentit kannan numeric-muotoon: "1234.50". */
export function centsToDecimal(cents: bigint): string {
  return scaledToDecimal(cents, 2);
}

export function scaledToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${int}${scale > 0 ? `.${frac}` : ""}`;
}

/** Sentit CSV:hen suomalaisella desimaalipilkulla ilman tuhaterotinta: "1234,50". */
export function centsToFi(cents: bigint): string {
  return centsToDecimal(cents).replace(".", ",");
}

export function sumCents(values: Iterable<bigint>): bigint {
  let s = 0n;
  for (const v of values) s += v;
  return s;
}
