/**
 * Postita.fi-kirjepalvelun julkisivu (Jukka 25.9.2026). Sovelluskoodi tuo
 * kaiken tästä eikä `http-client`- tai `mock`-moduulista suoraan.
 *
 * `POSTITA_MODE=http` → oikea rajapinta (tunnukset `POSTITA_USERNAME` ja
 * `POSTITA_PASSWORD`, samat kuin verkkopalvelussa). Muuten jäljitelmä, joka ei
 * lähetä mitään. Tuotannossa jäljitelmä ei kelpaa: `assertRealPostita()`
 * estää kirjeiden latauksen, jottei kukaan luule kirjeiden lähteneen.
 *
 * Postita tulostaa A4-arkit mustavalkoisena isoikkunaiseen C5-kuoreen ja
 * lähettää vahvistetut työt seuraavana arkipäivänä. Tunnukset ovat
 * ympäristökohtaiset: kaikki organisaatiot käyttävät samaa Postita-tiliä
 * (DECISIONS 2026-09-25).
 */

import { PostitaHttpClient } from "./http-client";
import { PostitaMockClient } from "./mock";
import { PostitaError, type PostitaClient } from "./types";

let cached: PostitaClient | null = null;

export function postitaMode(): "http" | "mock" {
  // Välilyönti tai iso kirjain Vercelin kentässä ei saa pudottaa jäljitelmään huomaamatta.
  return process.env.POSTITA_MODE?.trim().toLowerCase() === "http" ? "http" : "mock";
}

export function getPostitaClient(): PostitaClient {
  if (cached) return cached;
  if (postitaMode() === "http") {
    const username = process.env.POSTITA_USERNAME?.trim();
    const password = process.env.POSTITA_PASSWORD;
    if (!username || !password) throw new PostitaError("not_configured", "Kirjepalvelun tunnuksia ei ole määritetty.");
    cached = new PostitaHttpClient({ username, password, baseUrl: process.env.POSTITA_API_URL?.trim() || undefined });
  } else {
    cached = new PostitaMockClient();
  }
  return cached;
}

export function isUsingMockPostita(): boolean {
  return postitaMode() !== "http";
}

/** Kaataa, jos tuotannossa ollaan jäljitelmän varassa. Kutsu ennen latausta ja vahvistusta. */
export function assertRealPostita(): void {
  if (process.env.NODE_ENV === "production" && postitaMode() !== "http") {
    throw new PostitaError("not_configured", "Kirjepalvelua ei ole otettu käyttöön. Kirjeitä ei voi lähettää.");
  }
}

/** Testien käyttöön. */
export function resetPostitaClientForTests(): void {
  cached = null;
}

export { toUrlSafeBase64 } from "./http-client";
export {
  estimatePrice,
  EXTRA_PAGE_PRICE_EUR,
  isPostitaError,
  LETTER_PRICE_EUR,
  MAX_PAGES_PER_LETTER,
  PostitaError,
  type PostClass,
  type PostitaClient,
  type PostitaErrorCode,
  type PostitaJob,
  type PostitaJobStatus,
  type UploadInput,
} from "./types";
