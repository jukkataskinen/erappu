// KONEELLISESTI KOPIOITU – älä muokkaa.
// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client
/**
 * eSinetin webhookien vastaanotto (`round.completed` → sinetöity PDF
 * asiakirjoihin ja kohteen tila päivittyy).
 *
 * ===========================================================================
 * TIETOTURVA
 *
 * 1. Kuka saa kutsua: kuka tahansa internetistä — webhook-osoite on julkinen.
 *    Ainoa suoja on allekirjoitus, ja siksi `verifyWebhookSignature` on
 *    pakollinen ennen kuin payloadista uskotaan mitään. Ilman sitä kuka
 *    tahansa voisi väittää pöytäkirjan allekirjoitetuksi.
 * 2. Henkilötieto: payloadissa on allekirjoittajan nimi ja sähköposti, ei
 *    henkilötunnusta eikä syntymäaikaa (eSinetti `webhooks/payload.ts`).
 *    Tätä ei saa lokittaa.
 * 3. Syöte: zod tarkistaa muodon. Tuntematon tapahtumatyyppi ei ole virhe —
 *    eSinetti voi lisätä uusia, eikä vanhan version pidä kaatua niihin.
 * 4. Toisto: allekirjoitukseen kuuluu aikaleima, ja yli 5 minuutin ikäinen
 *    hylätään. Sama tapahtuma voi silti tulla useasti (eSinetti yrittää
 *    uudelleen 1 min … 24 h), joten **käsittelyn on oltava idempotenttia** —
 *    `id` on tapahtuman tunniste, jonka perusteella toisto tunnistetaan.
 * 5. Salaisuudet: `ESINETTI_WEBHOOK_SECRET` luetaan vain palvelimella, eikä
 *    sitä palauteta virheviestissä.
 * 6. Epäonnistuminen: virheellinen allekirjoitus → ei käsittelyä, ei
 *    vihjettä siitä mikä meni pieleen. Kutsujalle vain 401.
 * 7. Lokitus: ei payloadia, ei otsakkeita, ei sähköposteja.
 *
 * HUOM: allekirjoitus lasketaan **raa'asta rungosta**. Jos runko jäsennetään
 * ja sarjallistetaan uudelleen, tavut muuttuvat ja tarkistus epäonnistuu —
 * lue reitillä `await request.text()` ja anna sama merkkijono tänne.
 * ===========================================================================
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Suurin sallittu kellopoikkeama. Sama arvo kuin eSinetin omassa referenssitoteutuksessa. */
const TOLERANCE_SECONDS = 300;

const SIGNATURE_PATTERN = /^t=(\d+),v1=([0-9a-f]+)$/;

/**
 * Tarkistaa `X-eSinetti-Signature`-otsikon.
 *
 * Muoto: `t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`.
 * Vertailu on vakioaikainen, jotta oikean allekirjoituksen arvaaminen
 * merkki kerrallaan ajastusta mittaamalla ei onnistu.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (!secret || !header) return false;

  const match = SIGNATURE_PATTERN.exec(header.trim());
  if (!match) return false;

  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(timestamp + "." + rawBody, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(match[2], "hex");
  // Pituusero on itsessään tieto, mutta se ei paljasta salaisuudesta mitään:
  // odotettu pituus on aina 32 tavua ja julkisesti tiedossa.
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * Tapahtumat, jotka eSinetti lähettää.
 *
 * `round.completed` vie kokouksen tilaan `minutes_signed`. Muut ovat
 * näytettävää tilatietoa: kuka on avannut, kuka on allekirjoittanut.
 */
export const WEBHOOK_EVENTS = [
  "round.sent",
  "signer.opened",
  "signer.identified",
  "signer.signed",
  "signer.declined",
  "round.completed",
  "round.cancelled",
  "round.expired",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

const webhookSignerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role_label: z.string().nullable().optional(),
  status: z.string(),
  opened_at: z.string().nullable().optional(),
  identified_at: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  declined_at: z.string().nullable().optional(),
});

const webhookDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  sealed_sha256: z.string().nullable(),
  download_url: z.string().nullable(),
});

/**
 * Tapahtuman nimi jätetään merkkijonoksi eikä rajata enumiin: eSinetti voi
 * lisätä uusia tapahtumia, eikä tuntematon nimi saa aiheuttaa 400:aa ja siten
 * loputonta uudelleenyritystä eSinetin päässä. Tuntematon ohitetaan hiljaa.
 */
const webhookPayloadSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  created_at: z.string().min(1),
  data: z.object({
    round_id: z.string().min(1),
    external_ref: z.string().nullable(),
    status: z.string(),
    signers: z.array(webhookSignerSchema),
    documents: z.array(webhookDocumentSchema),
  }),
});

export interface WebhookEvent {
  /** Tapahtuman tunniste. Käytä toiston tunnistamiseen. */
  id: string;
  event: string;
  createdAt: string;
  roundId: string;
  /** Kutsujan oma tunniste (`<sovellus>:<laji>:<uuid>`): kertoo mihin kohteeseen tapahtuma kuuluu. */
  externalRef: string | null;
  status: string;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    roleLabel: string | null;
    status: string;
    openedAt: string | null;
    identifiedAt: string | null;
    signedAt: string | null;
    declinedAt: string | null;
  }>;
  documents: Array<{
    id: string;
    name: string;
    sealedSha256: string | null;
    /** Voimassa 24 h. Lataa tiedosto omaan Storageen heti, älä tallenna linkkiä. */
    downloadUrl: string | null;
  }>;
}

/** Onko tapahtuma sellainen, jota käsittelemme? Tuntematon ei ole virhe. */
export function isKnownWebhookEvent(event: string): event is WebhookEventName {
  return (WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/** Jäsentää raa'an rungon. Palauttaa `null`, jos muoto ei kelpaa. */
export function parseWebhookPayload(rawBody: string): WebhookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) return null;

  const { id, event, created_at: createdAt, data } = parsed.data;

  return {
    id,
    event,
    createdAt,
    roundId: data.round_id,
    externalRef: data.external_ref,
    status: data.status,
    signers: data.signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      roleLabel: s.role_label ?? null,
      status: s.status,
      openedAt: s.opened_at ?? null,
      identifiedAt: s.identified_at ?? null,
      signedAt: s.signed_at ?? null,
      declinedAt: s.declined_at ?? null,
    })),
    documents: data.documents.map((d) => ({
      id: d.id,
      name: d.name,
      sealedSha256: d.sealed_sha256,
      downloadUrl: d.download_url,
    })),
  };
}

/**
 * Allekirjoitusotsikon muodostus. Käytetään kehityksen simulointiin ja
 * testeihin; sama algoritmi kuin eSinetin `webhooks/signature.ts`.
 */
export function buildWebhookSignatureHeader(secret: string, timestampSeconds: number, rawBody: string): string {
  const v1 = createHmac("sha256", secret).update(timestampSeconds + "." + rawBody, "utf8").digest("hex");
  return "t=" + timestampSeconds + ",v1=" + v1;
}
