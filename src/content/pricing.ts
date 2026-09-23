/**
 * eRapun hinnoittelu (Jukka 23.9.2026). Hinnat ovat alv 0 %.
 *
 * Kaksi hinnastoa (Jukan antamat luvut, ei laskettuja): vuosi etukäteen
 * maksettuna hinta on noin kymmenyksen halvempi kuin kuukausilaskutuksessa.
 */

export const VAT_NOTE = "Hinnat ovat arvonlisäverottomia (alv 0 %).";

/** Vuosimaksu, vuosi etukäteen: euroa kuukaudessa per taloyhtiö. */
export const YEARLY_MONTHLY = {
  base: 14.9,
  perUnit: 1.5,
  minimum: 24.9,
};

/** Kuukausilaskutus: euroa kuukaudessa per taloyhtiö. */
export const MONTHLY = {
  base: 16.5,
  perUnit: 1.69,
  minimum: 27.95,
};

export type Billing = "yearly" | "monthly";

/** Yhden taloyhtiön kuukausihinta: perusmaksu + huoneistot, vähintään minimi. */
export function monthlyPrice(units: number, billing: Billing): number {
  const p = billing === "yearly" ? YEARLY_MONTHLY : MONTHLY;
  return Math.max(p.minimum, p.base + p.perUnit * Math.max(0, units));
}

/**
 * Yhden taloyhtiön laskelma. Hinta on aina taloyhtiökohtainen: päätös
 * tehdään yhtiössä ja lasku menee yhtiölle, joten laskurissa ei lasketa
 * isännöintitoimiston koko kantaa.
 */
export function priceSummary(units: number, billing: Billing) {
  const month = monthlyPrice(units, billing);
  return {
    month,
    year: month * 12,
    perUnitMonth: month / Math.max(1, units),
    /** Paljonko vuosimaksu säästää kuukausilaskutukseen verrattuna. */
    yearlySaving: billing === "yearly" ? (monthlyPrice(units, "monthly") - month) * 12 : 0,
  };
}

export function formatEuro(value: number): string {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
