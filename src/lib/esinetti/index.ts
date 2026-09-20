/**
 * eSinetti-liitännän julkisivu. Sovelluskoodi tuo kaiken tästä eikä koskaan
 * `http-client`- tai `mock`-moduulista suoraan (paitsi kehityksen
 * simulointi, joka on nimenomaan mockin ominaisuus).
 *
 * ===========================================================================
 * KUMPI CLIENT ON KÄYTÖSSÄ
 *
 * `ESINETTI_MODE=http` → oikea client (vaatii `ESINETTI_API_KEY`:n).
 * Muuten mock (CLAUDE.md 1: `ESINETTI_MODE=mock` oletuksena).
 *
 * Reilusopparissa valinta tehtiin avaimen olemassaolosta. eRapussa tila on
 * eksplisiittinen kuten HTJ:ssä ja sähköpostissa, mutta tuotannossa mock ei
 * kelpaa: `assertRealEsinetti()` kaataa allekirjoituksen, jos tuotannossa
 * ollaan mockin varassa.
 * ===========================================================================
 */

import { EsinettiError } from "./errors";
import { EsinettiHttpClient } from "./http-client";
import { EsinettiMockClient } from "./mock";
import type { CreateRoundInput, EsinettiClient, Round } from "./types";

let cached: EsinettiClient | null = null;

export function esinettiMode(): "http" | "mock" {
  return process.env.ESINETTI_MODE === "http" ? "http" : "mock";
}

export function getEsinettiClient(): EsinettiClient {
  if (cached) return cached;
  if (esinettiMode() === "http") {
    const apiKey = process.env.ESINETTI_API_KEY?.trim();
    if (!apiKey) throw new EsinettiError("not_configured", "Allekirjoituspalvelun yhteyttä ei ole määritetty.");
    const apiUrl = process.env.ESINETTI_API_URL?.trim() || "https://app.esinetti.fi/api/v1";
    cached = new EsinettiHttpClient({ apiUrl, apiKey });
  } else {
    cached = new EsinettiMockClient();
  }
  return cached;
}

export function isUsingMockEsinetti(): boolean {
  return esinettiMode() !== "http";
}

/** Kehityksen "Simuloi allekirjoitus" -nappi näkyy vain tässä tilanteessa. */
export function canSimulateSigning(): boolean {
  return esinettiMode() !== "http" && process.env.NODE_ENV !== "production";
}

/** Kaataa, jos tuotannossa ollaan mockin varassa. Kutsu allekirjoituksen yhteydessä. */
export function assertRealEsinetti(): void {
  if (process.env.NODE_ENV === "production" && esinettiMode() !== "http") {
    throw new EsinettiError("not_configured", "Allekirjoitusta ei voi tehdä jäljitelmällä tuotannossa.");
  }
}

/**
 * Luo kierroksen enintään kerran ulkoista viitettä kohti.
 *
 * eSinetissä ei ole `Idempotency-Key`-tukea, ja luonti voi onnistua siellä
 * vaikka vastaus ei ehtisi meille (aikakatkaisu, verkkovirhe). Silloin
 * uudelleenyritys tekisi toisen kierroksen, ja samat ihmiset saisivat kaksi
 * allekirjoituspyyntöä samasta asiakirjasta. Siksi ennen luontia katsotaan,
 * onko viitteellä jo kierros.
 *
 * Löytynyt peruttu tai vanhentunut kierros ei estä uutta (client suodattaa ne).
 */
export async function createRoundOnce(client: EsinettiClient, input: CreateRoundInput & { externalRef: string }): Promise<Round> {
  const existing = await client.findRoundByExternalRef(input.externalRef);
  if (existing) return existing;
  return client.createRound(input);
}

/** Testien käyttöön. */
export function resetEsinettiClientForTests(): void {
  cached = null;
}

export { EsinettiError, isEsinettiError, type EsinettiErrorCode } from "./errors";
export {
  buildExternalRef,
  buildWebhookSignatureHeader,
  isKnownWebhookEvent,
  parseExternalRef,
  parseWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_EVENTS,
  type ExternalRefKind,
  type WebhookEvent,
  type WebhookEventName,
} from "./webhook";
export type {
  CreateRoundInput,
  EsinettiClient,
  EsinettiCompany,
  EsinettiCompanyInput,
  Round,
  RoundDocument,
  RoundDocumentInput,
  RoundSigner,
  RoundSignerState,
  RoundStatus,
  SealDocumentInput,
  SealDocumentResult,
  SignerStatus,
  VerifyResult,
} from "./types";
