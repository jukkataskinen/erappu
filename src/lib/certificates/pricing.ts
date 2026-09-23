/**
 * Todistusten hinnat ja tilat.
 *
 * eRapussa ei ole omaa hinnastoa (Jukka 23.9.2026): jokainen isännöitsijä
 * päättää todistuksen hinnan itse tai yhdessä hallituksen kanssa. Hinnat
 * tulevat vain organisaation asetuksista (`certificate_prices`). Jos niitä ei
 * ole annettu, tilaus jää hinnoittelematta (`price_eur` on tyhjä) ja hinta
 * sovitaan laskutuksessa.
 */

/**
 * Isännöitsijäntodistuspohjan juridinen hyväksyntä. Kun tämä on epätosi,
 * PDF:ään tulee "LUONNOS – sisältö tarkistettava". Jukka hyväksyi sisällön
 * 23.9.2026 (BLOCKERS 4).
 */
export const CERTIFICATE_TEMPLATE_APPROVED = true;

export interface CertificatePriceSettings {
  standard_eur?: number | null;
  express_eur?: number | null;
  /** Liitteineen-version hinta. Oletuksena sama kuin tavallinen todistus (Jukan päätös). */
  with_attachments_eur?: number | null;
}

/** Null = isännöinti ei ole antanut hintaa, jolloin tilausta ei hinnoitella. */
export interface ResolvedPrices {
  standard: number | null;
  express: number | null;
  withAttachments: number | null;
}

const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function resolvePrices(settings: CertificatePriceSettings | null | undefined): ResolvedPrices {
  const standard = valid(settings?.standard_eur) ? settings.standard_eur : null;
  const express = valid(settings?.express_eur) ? settings.express_eur : null;
  const withAttachments = valid(settings?.with_attachments_eur) ? settings.with_attachments_eur : standard;
  return { standard, express, withAttachments };
}

/** Onko organisaatio antanut yhtään hintaa. */
export function hasPrices(prices: ResolvedPrices): boolean {
  return prices.standard !== null || prices.express !== null || prices.withAttachments !== null;
}

/** Pikatoimituksen lisä tavalliseen hintaan nähden, tai null jos kumpaakaan ei ole annettu. */
export function expressSurcharge(prices: ResolvedPrices): number | null {
  if (prices.express === null || prices.standard === null) return null;
  return Math.max(0, prices.express - prices.standard);
}

/**
 * Tilauksen hinta annetuista hinnoista, tai null jos hintaa ei ole annettu.
 * Pikatoimitus on lisä tavalliseen hintaan nähden (pika − tavallinen), joten
 * liitteineen pikana = liitteineen + pikalisä.
 */
export function orderPrice(prices: ResolvedPrices, opts: { express: boolean; withAttachments: boolean }): number | null {
  const base = (opts.withAttachments ? prices.withAttachments : prices.standard) ?? prices.standard;
  if (base === null) return opts.express ? prices.express : null;
  return Math.round((base + (opts.express ? expressSurcharge(prices) ?? 0 : 0)) * 100) / 100;
}

export const CERTIFICATE_KIND: Record<string, string> = {
  manager_certificate: "Isännöitsijäntodistus",
  loan_share_certificate: "Lainaosuustodistus",
};

export const ORDER_STATUS: Record<string, string> = {
  new: "Uusi",
  in_progress: "Työn alla",
  delivered: "Toimitettu",
  invoiced: "Laskutettu",
  cancelled: "Peruttu",
};

export const ORDER_STATUS_TONE: Record<string, "neutral" | "info" | "ok" | "warn" | "alert"> = {
  new: "alert",
  in_progress: "warn",
  delivered: "ok",
  invoiced: "neutral",
  cancelled: "neutral",
};
