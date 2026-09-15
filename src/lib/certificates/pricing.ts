/**
 * Todistusten hinnat ja tilat.
 *
 * TODO(Jukka): hinnasto. Vakiot ovat paikkamerkkejä, kunnes Adeptan
 * isännöinnin hinnasto on vahvistettu (DECISIONS 2026-09-15). Organisaation
 * asetuksissa (`certificate_prices`) annetut hinnat ohittavat vakiot.
 */
export const CERTIFICATE_PRICE_EUR = 120;
export const CERTIFICATE_EXPRESS_PRICE_EUR = 180;

/**
 * Isännöitsijäntodistuspohjan juridinen hyväksyntä. Kun tämä on epätosi,
 * PDF:ään tulee "LUONNOS – sisältö tarkistettava" (BLOCKERS 4).
 */
export const CERTIFICATE_TEMPLATE_APPROVED = false;

export function certificatePrice(express: boolean): number {
  return express ? CERTIFICATE_EXPRESS_PRICE_EUR : CERTIFICATE_PRICE_EUR;
}

export interface CertificatePriceSettings {
  standard_eur?: number | null;
  express_eur?: number | null;
  /** Liitteineen-version hinta. Oletuksena sama kuin tavallinen todistus (Jukan päätös). */
  with_attachments_eur?: number | null;
}

export interface ResolvedPrices {
  standard: number;
  express: number;
  withAttachments: number;
}

const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function resolvePrices(settings: CertificatePriceSettings | null | undefined): ResolvedPrices {
  const standard = valid(settings?.standard_eur) ? settings.standard_eur : CERTIFICATE_PRICE_EUR;
  const express = valid(settings?.express_eur) ? settings.express_eur : CERTIFICATE_EXPRESS_PRICE_EUR;
  const withAttachments = valid(settings?.with_attachments_eur) ? settings.with_attachments_eur : standard;
  return { standard, express, withAttachments };
}

/**
 * Tilauksen hinta. Pikatoimitus on lisä tavalliseen hintaan nähden
 * (pika − tavallinen), joten liitteineen pikana = liitteineen + pikalisä.
 */
export function orderPrice(prices: ResolvedPrices, opts: { express: boolean; withAttachments: boolean }): number {
  const base = opts.withAttachments ? prices.withAttachments : prices.standard;
  const surcharge = opts.express ? Math.max(0, prices.express - prices.standard) : 0;
  return Math.round((base + surcharge) * 100) / 100;
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
