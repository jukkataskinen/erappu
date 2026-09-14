import { addDays, daysInclusive, fiDate, maxDate, minDate } from "./dates";
import { BASIS, CHARGE_TYPE, formatPrice, trimDecimal } from "./labels";
import { parseScaled, roundDiv, scaledToDecimal } from "./money";

/**
 * Vastikkeiden laskenta.
 *
 * Yksikköhinta on kannassa neljällä desimaalilla (esim. 3,1500 €/m²/kk) ja
 * pinta-ala yhdellä. Summa lasketaan kokonaisluvuilla ja pyöristetään
 * senttiin vasta rivin lopuksi, jotta osakeryhmän vastike on sama kuin
 * käsin laskettuna.
 */

export type BasisKind = "area_m2" | "share" | "unit" | "person" | "meter" | "fixed";

export interface ChargeBasisInput {
  id: string;
  charge_type: string;
  label: string | null;
  basis: BasisKind | string;
  unit_price: string;
  vat_percent: string;
  applies_to_kinds: string[] | null;
  starts_on: string;
  ends_on: string | null;
}

export interface BillableGroup {
  id: string;
  unit_label: string;
  kind: string;
  area_m2: string | null;
  share_count: number;
  /** Asukasmäärä henkilöperusteista maksua varten; null = ei tiedossa. */
  resident_count?: number | null;
}

export interface ChargeLine {
  chargeBasisId: string;
  chargeType: string;
  description: string;
  /** Määrä neljällä desimaalilla, kannan numeric(14,4)-muodossa. */
  quantity: string;
  unitPrice: string;
  amountCents: bigint;
  vatPercent: string;
  startsOn: string;
  endsOn: string;
  prorated: boolean;
}

export interface Period {
  start: string;
  end: string;
}

const QTY_SCALE = 4;
const PRICE_SCALE = 4;

export function appliesToKind(basis: Pick<ChargeBasisInput, "applies_to_kinds">, kind: string): boolean {
  return !basis.applies_to_kinds || basis.applies_to_kinds.length === 0 || basis.applies_to_kinds.includes(kind);
}

export function isEffectiveOn(basis: Pick<ChargeBasisInput, "starts_on" | "ends_on">, date: string): boolean {
  return basis.starts_on <= date && (basis.ends_on === null || basis.ends_on >= date);
}

/** Kohdistuvatko perusteet samaan vastikkeeseen (sama laji ja huoneistotyypit). */
export function sameStream(a: Pick<ChargeBasisInput, "charge_type" | "applies_to_kinds">, b: Pick<ChargeBasisInput, "charge_type" | "applies_to_kinds">): boolean {
  const norm = (k: string[] | null) => (k && k.length ? [...k].sort().join(",") : "*");
  return a.charge_type === b.charge_type && norm(a.applies_to_kinds) === norm(b.applies_to_kinds);
}

/**
 * Voimassa oleva peruste päivälle. Jos päällekkäisiä on (ei pitäisi olla,
 * koska uusi peruste päättää edellisen), myöhemmin alkanut voittaa.
 */
export function effectiveBasis<T extends ChargeBasisInput>(bases: T[], chargeType: string, date: string, kind?: string): T | null {
  const candidates = bases
    .filter((b) => b.charge_type === chargeType && isEffectiveOn(b, date) && (kind === undefined || appliesToKind(b, kind)))
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : a.starts_on > b.starts_on ? -1 : 0));
  return candidates[0] ?? null;
}

/**
 * Uuden perusteen vaikutus vanhoihin: saman vastikkeen voimassa olevat
 * perusteet päättyvät uutta alkupäivää edeltävänä päivänä. Myöhemmin
 * alkavaa perustetta ei ohiteta hiljaa, vaan se palautetaan ristiriitana.
 */
export function planBasisSuccession<T extends ChargeBasisInput>(
  existing: T[],
  next: Pick<ChargeBasisInput, "charge_type" | "applies_to_kinds" | "starts_on">,
): { toEnd: T[]; endsOn: string; conflicts: T[] } {
  const stream = existing.filter((b) => sameStream(b, next));
  const conflicts = stream.filter((b) => b.starts_on >= next.starts_on);
  const toEnd = stream.filter((b) => b.starts_on < next.starts_on && (b.ends_on === null || b.ends_on >= next.starts_on));
  return { toEnd, endsOn: addDays(next.starts_on, -1), conflicts };
}

/** Määrä perusteen mukaan, skaalattuna 10^4. null = ei laskettavissa. */
export function quantityFor(basis: string, group: BillableGroup): bigint | null {
  switch (basis) {
    case "area_m2":
      return group.area_m2 === null || group.area_m2 === "" ? null : parseScaled(group.area_m2, QTY_SCALE);
    case "share":
      return BigInt(group.share_count) * 10n ** BigInt(QTY_SCALE);
    case "unit":
    case "fixed":
      return 10n ** BigInt(QTY_SCALE);
    case "person":
      return group.resident_count === null || group.resident_count === undefined ? null : BigInt(group.resident_count) * 10n ** BigInt(QTY_SCALE);
    default:
      // Mittariperusteinen maksu vaatii lukemat, joita rekisterissä ei ole.
      return null;
  }
}

/** Summa sentteinä: määrä × hinta × (päivät kaudella / kauden päivät). */
export function lineAmountCents(quantityScaled: bigint, unitPrice: string, days = 1, periodDays = 1): bigint {
  const price = parseScaled(unitPrice, PRICE_SCALE);
  // määrä 10^4 × hinta 10^4 = 10^8; sentit ovat 10^2 → jaetaan 10^6:lla.
  return roundDiv(quantityScaled * price * BigInt(days), 10n ** 6n * BigInt(periodDays));
}

export interface GroupChargeResult {
  lines: ChargeLine[];
  warnings: string[];
}

/**
 * Osakeryhmän vastikkeet laskutuskaudelle. Jos peruste vaihtuu kesken
 * kauden, kumpikin peruste laskutetaan päivien suhteessa omana rivinään.
 */
export function chargesForGroup(bases: ChargeBasisInput[], group: BillableGroup, period: Period): GroupChargeResult {
  const lines: ChargeLine[] = [];
  const warnings: string[] = [];
  const periodDays = daysInclusive(period.start, period.end);

  const relevant = bases
    .filter((b) => appliesToKind(b, group.kind))
    .filter((b) => b.starts_on <= period.end && (b.ends_on === null || b.ends_on >= period.start))
    .sort((a, b) => a.charge_type.localeCompare(b.charge_type) || a.starts_on.localeCompare(b.starts_on));

  for (const b of relevant) {
    const qty = quantityFor(b.basis, group);
    const name = b.label || CHARGE_TYPE[b.charge_type] || b.charge_type;
    if (qty === null) {
      warnings.push(
        b.basis === "area_m2"
          ? `${group.unit_label}: pinta-ala puuttuu (${name})`
          : b.basis === "person"
            ? `${group.unit_label}: asukasmäärä puuttuu (${name})`
            : `${group.unit_label}: ${name} lasketaan mittarilukemista, ei automaattisesti`,
      );
      continue;
    }
    const start = maxDate(b.starts_on, period.start);
    const end = minDate(b.ends_on ?? period.end, period.end);
    const days = daysInclusive(start, end);
    const prorated = days !== periodDays;
    const amountCents = lineAmountCents(qty, b.unit_price, days, periodDays);
    if (amountCents === 0n) continue;

    const unit = BASIS[b.basis]?.unit ?? "";
    const qtyText = b.basis === "fixed" || b.basis === "unit" ? "" : `${trimDecimal(scaledToDecimal(qty, QTY_SCALE))} ${unit} × `;
    const priceText = b.basis === "fixed" ? `${formatPrice(b.unit_price)} €/kk` : `${formatPrice(b.unit_price)} €/${unit}/kk`;
    const span = prorated ? ` (${fiDate(start)}–${fiDate(end)}, ${days}/${periodDays} pv)` : "";

    lines.push({
      chargeBasisId: b.id,
      chargeType: b.charge_type,
      description: `${name} ${qtyText}${priceText}${span}`,
      quantity: scaledToDecimal(qty, QTY_SCALE),
      unitPrice: b.unit_price,
      amountCents,
      vatPercent: b.vat_percent,
      startsOn: start,
      endsOn: end,
      prorated,
    });
  }
  return { lines, warnings };
}

/** Kuukausivastike yhteensä sentteinä (portaali, erittely). */
export function monthlyTotalCents(bases: ChargeBasisInput[], group: BillableGroup, period: Period): bigint {
  return chargesForGroup(bases, group, period).lines.reduce((s, l) => s + l.amountCents, 0n);
}
