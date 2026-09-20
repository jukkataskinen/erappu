/**
 * Webhookien tarkistus ja jäsennys on yhteisessä clientissa (`vendor/`,
 * npm run esinetti:sync-client). Tässä on vain eRapun oma osuus: ulkoisen
 * viitteen muoto, jolla tapahtuma yhdistetään kohteeseen.
 */
export * from "./vendor/webhook";

/**
 * Kohteet, joita eRappu allekirjoituttaa tai sinetöi: pöytäkirjat, massaluonnin
 * sopimukset ja isännöitsijäntodistukset (sinetöinnin metatiedoissa, ei
 * webhook-kierrosta). Laajenee muutostyölupiin.
 */
export type ExternalRefKind = "meeting" | "contract" | "certificate";

/**
 * `externalRef` → kohteen tyyppi ja id.
 *
 * Muoto on eRapun oma (`erappu:meeting:<uuid>`, `erappu:contract:<erän rivin uuid>`). Tuntematon muoto palauttaa
 * `null` — silloin tapahtuma ohitetaan sen sijaan, että arvattaisiin.
 */
export function parseExternalRef(externalRef: string | null): { kind: ExternalRefKind; id: string } | null {
  if (!externalRef) return null;
  const match = /^erappu:(meeting|contract|certificate):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(externalRef);
  if (!match) return null;
  return { kind: match[1] as ExternalRefKind, id: match[2] };
}

export function buildExternalRef(kind: ExternalRefKind, id: string): string {
  return "erappu:" + kind + ":" + id;
}
