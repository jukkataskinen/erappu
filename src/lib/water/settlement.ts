import { effectiveBasis, lineAmountCents, type ChargeBasisInput, type Period } from "@/lib/finance/charges";
import { addDays, daysInclusive, fiDate, maxDate, minDate, monthPeriod } from "@/lib/finance/dates";
import { formatPrice, trimDecimal } from "@/lib/finance/labels";
import { centsToDecimal, parseScaled, roundDiv, scaledToDecimal, toCents } from "@/lib/finance/money";

/**
 * Vesimaksun laskenta (puhtaat funktiot).
 *
 * Vesiennakko laskutetaan kuukausittain vastikelaskulla. Tasauslaskussa
 * kulutus lasketaan mittareittain edellisestä laskutetusta lukemasta
 * (tai mittarin aloituslukemasta) lukukierroksen lukemaan, ja kauden
 * ennakot vähennetään miinusrivinä. Sama ennakkolaskenta on molemmissa,
 * joten hyvitys vastaa laskutettua.
 */

export type MeterKind = "cold" | "hot";

export const METER_KIND: Record<MeterKind, string> = {
  cold: "Kylmä vesi",
  hot: "Lämmin vesi",
};

export interface WaterAdvance {
  share_group_id: string;
  monthly_eur: string;
  starts_on: string;
  ends_on: string | null;
}

export interface WaterMeter {
  id: string;
  share_group_id: string;
  kind: MeterKind;
  meter_number: string | null;
  installed_on: string;
  start_reading: string;
  removed_on: string | null;
  final_reading: string | null;
}

export interface MeterReading {
  value: string;
  on: string;
}

const READING_SCALE = 3;
const QTY_SCALE = 4;

// ---------------------------------------------------------------------------
// Ennakot
// ---------------------------------------------------------------------------

export interface AdvancePart {
  monthlyEur: string;
  start: string;
  end: string;
  /** Kokonaiset kalenterikuukaudet; null, jos osa kuukaudesta. */
  fullMonths: number | null;
  cents: bigint;
}

/**
 * Ennakot kaudelle kuukausittain. Kuukauden ennakko jaetaan päivien
 * suhteessa, jos sopimus alkaa tai päättyy kesken kuukauden.
 * Peräkkäiset saman suuruiset kuukaudet yhdistetään yhdeksi osaksi.
 */
export function advanceParts(advances: WaterAdvance[], shareGroupId: string, period: Period): AdvancePart[] {
  const own = advances.filter((a) => a.share_group_id === shareGroupId);
  const parts: AdvancePart[] = [];
  let month = period.start.slice(0, 7);
  while (`${month}-01` <= period.end) {
    const m = monthPeriod(month);
    const monthDays = daysInclusive(m.start, m.end);
    for (const a of own) {
      const start = maxDate(maxDate(a.starts_on, m.start), period.start);
      const end = minDate(minDate(a.ends_on ?? m.end, m.end), period.end);
      if (start > end) continue;
      const days = daysInclusive(start, end);
      const monthly = toCents(a.monthly_eur);
      if (monthly === 0n) continue;
      const cents = roundDiv(monthly * BigInt(days), BigInt(monthDays));
      const full = days === monthDays;
      const prev = parts.at(-1);
      if (prev && full && prev.fullMonths !== null && prev.monthlyEur === a.monthly_eur && addDays(prev.end, 1) === start) {
        prev.end = end;
        prev.fullMonths += 1;
        prev.cents += cents;
      } else {
        parts.push({
          monthlyEur: a.monthly_eur,
          start,
          end,
          fullMonths: full ? 1 : null,
          cents,
        });
      }
    }
    month = addDays(m.end, 1).slice(0, 7);
  }
  return parts;
}

export function advanceCents(advances: WaterAdvance[], shareGroupId: string, period: Period): bigint {
  return advanceParts(advances, shareGroupId, period).reduce((s, p) => s + p.cents, 0n);
}

const eur = (value: string) => formatPrice(Number(value).toFixed(2));

/** Kuukausilaskun ennakkorivin selite: "Vesiennakko 25,00 €/kk". */
export function monthlyAdvanceDescription(part: AdvancePart, period: Period): string {
  const whole = part.start === period.start && part.end === period.end;
  return `Vesiennakko ${eur(part.monthlyEur)} €/kk${whole ? "" : ` (${fiDate(part.start)}–${fiDate(part.end)})`}`;
}

/** Tasauslaskun hyvitysrivin selite: "Maksetut vesiennakot 1.1.2026–31.12.2026, 12 kk × 25,00 €". */
export function settlementAdvanceDescription(part: AdvancePart): string {
  const span = `${fiDate(part.start)}–${fiDate(part.end)}`;
  return part.fullMonths !== null
    ? `Vesiennakot ${span}, ${part.fullMonths} kk × ${eur(part.monthlyEur)} €`
    : `Vesiennakko ${span}, ${eur(part.monthlyEur)} €/kk osalta kuukautta`;
}

// ---------------------------------------------------------------------------
// Mittarit ja kulutus
// ---------------------------------------------------------------------------

export type MeterSpan =
  | { ok: true; start: MeterReading; end: MeterReading; consumption: string }
  | {
      ok: false;
      reason: "not_installed" | "already_settled" | "missing_reading" | "negative";
      start?: MeterReading;
      end?: MeterReading;
    };

/**
 * Mittarin laskutettava väli lukukierrokselle. Vanha lukema on edellisessä
 * tasauksessa laskutettu lukema tai mittarin aloituslukema. Uusi lukema on
 * kierroksen lukema; poistetulla mittarilla loppulukema.
 */
export function meterSpan(meter: WaterMeter, roundDate: string, roundReading: MeterReading | null, lastBilled: MeterReading | null): MeterSpan {
  if (meter.installed_on > roundDate) return { ok: false, reason: "not_installed" };
  const start: MeterReading = lastBilled ?? {
    value: meter.start_reading,
    on: meter.installed_on,
  };
  let end: MeterReading | null;
  if (meter.removed_on && meter.final_reading !== null && meter.removed_on <= roundDate) {
    if (lastBilled && lastBilled.on >= meter.removed_on) return { ok: false, reason: "already_settled" };
    end = { value: meter.final_reading, on: meter.removed_on };
  } else {
    end = roundReading;
  }
  if (!end) return { ok: false, reason: "missing_reading", start };
  const diff = parseScaled(end.value, READING_SCALE) - parseScaled(start.value, READING_SCALE);
  if (diff < 0n) return { ok: false, reason: "negative", start, end };
  return {
    ok: true,
    start,
    end,
    consumption: scaledToDecimal(diff, READING_SCALE),
  };
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function meterLabel(meter: Pick<WaterMeter, "kind" | "meter_number">): string {
  return `${METER_KIND[meter.kind]}${meter.meter_number ? `, mittari ${meter.meter_number}` : ""}`;
}

/** "Kylmä vesi, mittari 123: lukema 31.12.2025 120,5 → 31.12.2026 160,2 = 39,7 m³ × 4,20 €/m³" */
export function consumptionDescription(
  meter: Pick<WaterMeter, "kind" | "meter_number">,
  start: MeterReading,
  end: MeterReading,
  consumption: string,
  unitPrice: string,
): string {
  return `${meterLabel(meter)}: lukema ${fiDate(start.on)} ${trimDecimal(start.value)} → ${fiDate(end.on)} ${trimDecimal(end.value)} = ${trimDecimal(consumption)} m³ × ${formatPrice(unitPrice)} €/m³`;
}

// ---------------------------------------------------------------------------
// Tasauslaskun rivit
// ---------------------------------------------------------------------------

export interface SettlementLine {
  shareGroupId: string;
  lineNo: number;
  chargeBasisId: string | null;
  chargeType: "water" | "hot_water" | "water_advance";
  description: string;
  quantity: string;
  unitPrice: string;
  amountCents: bigint;
  vatPercent: string;
  meterId: string | null;
  readingStart: MeterReading | null;
  readingEnd: MeterReading | null;
}

export interface SettlementGroup {
  id: string;
  unit_label: string;
}

export interface SettlementInput {
  period: Period;
  roundDate: string;
  bases: ChargeBasisInput[];
  groups: SettlementGroup[];
  meters: WaterMeter[];
  roundReadings: Map<string, MeterReading>;
  lastBilled: Map<string, MeterReading>;
  advances: WaterAdvance[];
}

export interface SettlementResult {
  lines: SettlementLine[];
  warnings: string[];
  /** Osakeryhmät, joiden tasaus on hyvitys (summa alle nollan). */
  creditGroups: number;
}

function meterBasis(bases: ChargeBasisInput[], chargeType: string, date: string): ChargeBasisInput | null {
  return effectiveBasis(
    bases.filter((x) => x.basis === "meter"),
    chargeType,
    date,
  );
}

/**
 * Tasauslaskun rivit osakeryhmittäin: mittareiden kulutus hinnalla
 * (lämmin vesi omalla hinnallaan, jos sellainen on) ja ennakot miinusrivinä.
 * Hinta on kierroksen päivänä voimassa oleva; jos hinta on vaihtunut
 * kauden aikana, siitä varoitetaan.
 */
export function buildSettlementLines(input: SettlementInput): SettlementResult {
  const warnings: string[] = [];
  const lines: SettlementLine[] = [];
  let creditGroups = 0;
  const water = meterBasis(input.bases, "water", input.roundDate);
  const hot = meterBasis(input.bases, "hot_water", input.roundDate);
  if (!water) throw new Error("NO_WATER_PRICE");
  const changed = input.bases.filter(
    (b) =>
      b.basis === "meter" && (b.charge_type === "water" || b.charge_type === "hot_water") && b.starts_on > input.period.start && b.starts_on <= input.roundDate,
  );
  if (changed.length > 0)
    warnings.push(
      `Vesimaksun hinta on muuttunut kauden aikana (${changed.map((b) => fiDate(b.starts_on)).join(", ")}). Koko kulutus lasketaan ${fiDate(input.roundDate)} voimassa olevalla hinnalla.`,
    );

  const groups = [...input.groups].sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }));
  for (const g of groups) {
    const groupLines: SettlementLine[] = [];
    const meters = input.meters
      .filter((m) => m.share_group_id === g.id)
      .sort((a, b) => (a.kind === b.kind ? a.installed_on.localeCompare(b.installed_on) : a.kind === "cold" ? -1 : 1));
    let lineNo = 0;
    for (const m of meters) {
      const span = meterSpan(m, input.roundDate, input.roundReadings.get(m.id) ?? null, input.lastBilled.get(m.id) ?? null);
      if (!span.ok) {
        if (span.reason === "missing_reading") warnings.push(`${g.unit_label}: ${lowerFirst(meterLabel(m))} lukema puuttuu`);
        if (span.reason === "negative")
          warnings.push(
            `${g.unit_label}: ${lowerFirst(meterLabel(m))} uusi lukema ${trimDecimal(span.end!.value)} on pienempi kuin vanha ${trimDecimal(span.start!.value)}`,
          );
        continue;
      }
      const qty = parseScaled(span.consumption, QTY_SCALE);
      // Lämpimällä vedellä on usein oma hinta; ilman sitä käytetään vesimaksun hintaa.
      const price = m.kind === "hot" && hot ? hot : water;
      groupLines.push({
        shareGroupId: g.id,
        lineNo: ++lineNo,
        chargeBasisId: price.id,
        chargeType: price === hot ? "hot_water" : "water",
        description: consumptionDescription(m, span.start, span.end, span.consumption, price.unit_price),
        quantity: scaledToDecimal(qty, QTY_SCALE),
        unitPrice: price.unit_price,
        amountCents: lineAmountCents(qty, price.unit_price),
        vatPercent: price.vat_percent,
        meterId: m.id,
        readingStart: span.start,
        readingEnd: span.end,
      });
    }
    if (meters.length === 0 && input.advances.some((a) => a.share_group_id === g.id)) {
      warnings.push(`${g.unit_label}: vesiennakko on sovittu, mutta huoneistolla ei ole mittaria`);
    }

    for (const part of advanceParts(input.advances, g.id, input.period)) {
      const months = part.fullMonths;
      groupLines.push({
        shareGroupId: g.id,
        lineNo: ++lineNo,
        chargeBasisId: null,
        chargeType: "water_advance",
        description: settlementAdvanceDescription(part),
        quantity: months !== null ? `${months}.0000` : "1.0000",
        unitPrice: months !== null ? `-${Number(part.monthlyEur).toFixed(2)}00` : `-${centsToDecimal(part.cents)}00`,
        amountCents: -part.cents,
        vatPercent: "0.0",
        meterId: null,
        readingStart: null,
        readingEnd: null,
      });
    }

    const total = groupLines.reduce((s, l) => s + l.amountCents, 0n);
    if (groupLines.length > 0 && total < 0n) creditGroups++;
    lines.push(...groupLines);
  }
  return { lines, warnings, creditGroups };
}
