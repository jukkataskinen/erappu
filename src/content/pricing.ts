/**
 * eRapun hinnoittelu (Jukka 23.9.2026). Hinnat ovat alv 0 %.
 *
 * Perushinnat ovat vuosimaksun hintoja: vuosi etukäteen maksettuna asiakas
 * saa 10 %:n alennuksen. Kuukausilaskutuksen hinta lasketaan näistä
 * (hinta / 0,9), jotta luvut eivät ole kahdessa paikassa eri.
 */

export const VAT_NOTE = "Hinnat ovat arvonlisäverottomia (alv 0 %).";

/** Vuosimaksulla (10 % alennus): euroa kuukaudessa per taloyhtiö. */
export const YEARLY_MONTHLY = {
  base: 14.9,
  perUnit: 1.5,
  minimum: 24.9,
};

export const YEARLY_DISCOUNT = 0.1;

/** Kuukausilaskutuksen hinnat: vuosimaksun hinta ilman alennusta. */
export const MONTHLY = {
  base: YEARLY_MONTHLY.base / (1 - YEARLY_DISCOUNT),
  perUnit: YEARLY_MONTHLY.perUnit / (1 - YEARLY_DISCOUNT),
  minimum: YEARLY_MONTHLY.minimum / (1 - YEARLY_DISCOUNT),
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
