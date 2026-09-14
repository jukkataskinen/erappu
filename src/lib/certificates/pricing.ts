/**
 * Todistusten hinnat ja tilat.
 *
 * TODO(Jukka): hinnasto. Vakiot ovat paikkamerkkejä, kunnes Adeptan
 * isännöinnin hinnasto on vahvistettu (DECISIONS 2026-09-15).
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
