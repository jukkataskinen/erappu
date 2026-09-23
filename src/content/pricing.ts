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

/** Koko laskelma: yksi yhtiö ja kaikki yhtiöt, kuukaudessa ja vuodessa. */
export function priceSummary(companies: number, units: number, billing: Billing) {
  const perCompanyMonth = monthlyPrice(units, billing);
  const count = Math.max(1, companies);
  return {
    perCompanyMonth,
    perCompanyYear: perCompanyMonth * 12,
    totalMonth: perCompanyMonth * count,
    totalYear: perCompanyMonth * 12 * count,
    /** Paljonko vuosimaksu säästää kuukausilaskutukseen verrattuna. */
    yearlySaving: billing === "yearly" ? (monthlyPrice(units, "monthly") - perCompanyMonth) * 12 * count : 0,
  };
}

export function formatEuro(value: number): string {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
