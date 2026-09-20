// KONEELLISESTI KOPIOITU – älä muokkaa.
// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client
/**
 * eSinetti-kutsujen virheet.
 *
 * Yksi luokka, jossa on `code` ja `retryable`. Kutsujan ei tarvitse tulkita
 * HTTP-koodeja: se katsoo `retryable`-lipun ja päättää yrittääkö uudelleen.
 *
 * `message` on suomeksi ja näytettävissä käyttäjälle sellaisenaan. Se ei
 * koskaan sisällä API-avainta, URL:ia eikä eSinetin sisäistä rakennetta
 * (eSinetin virhekoodit).
 */

export type EsinettiErrorCode =
  | "unauthorized"
  | "not_found"
  | "validation_failed"
  | "rate_limited"
  | "conflict"
  | "gone"
  | "payload_too_large"
  | "service_unavailable"
  | "server_error"
  | "network_error"
  | "timeout"
  | "not_configured";

const RETRYABLE: ReadonlySet<EsinettiErrorCode> = new Set([
  "rate_limited",
  "service_unavailable",
  "server_error",
  "network_error",
  "timeout",
]);

export class EsinettiError extends Error {
  readonly code: EsinettiErrorCode;
  /** Kannattaako sama pyyntö lähettää uudelleen? */
  readonly retryable: boolean;

  constructor(code: EsinettiErrorCode, message: string) {
    super(message);
    this.name = "EsinettiError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

/** Onko virhe eSinetin virhe? Kaventaa tyypin `catch`-lohkossa. */
export function isEsinettiError(err: unknown): err is EsinettiError {
  return err instanceof EsinettiError;
}
