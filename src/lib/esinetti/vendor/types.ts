// KONEELLISESTI KOPIOITU – älä muokkaa.
// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client
/**
 * eSinetti-liitännän tyypit.
 *
 * Kutsuva järjestelmä ei toteuta tunnistusta, allekirjoitusta eikä sinetöintiä itse.
 * Nämä tyypit kuvaavat sen rajapinnan, jonka takana eSinetti on — ja vain sen.
 *
 * ===========================================================================
 * MITÄ TÄSSÄ EI OLE: RENDERÖINTI
 *
 * Kutsuva järjestelmä tekee allekirjoitettavan PDF:n itse, ja eSinetti
 * vain kerää allekirjoitukset ja sinetöi.
 * ===========================================================================
 *
 * ===========================================================================
 * SUOMENKIELISET NIMET, snake_case VAIN LANGALLA
 *
 * eSinetin REST-API käyttää snake_casea (`template_id`, `sealed_sha256`).
 * Tässä repossa käytetään camelCasea, ja muunnos tehdään yhdessä paikassa
 * (`http-client.ts`). Syy: jos wire-muoto vuotaisi sovelluskoodiin, eSinetin
 * API-muutos näkyisi kymmenissä tiedostoissa.
 *
 * MITÄ TÄSSÄ EI OLE
 *
 * Henkilötunnusta ei ole missään tyypissä eikä sitä saa lisätä (tietosuoja). `expectedBirthdate` on mukana, koska eSinetti käyttää sitä
 * tunnistuksen tarkistukseen, jos se on tiedossa.
 * ===========================================================================
 */

export interface SealDocumentInput {
  name: string;
  pdfBytes: Uint8Array;
  /**
   * Upotetaan sinetöidyn PDF:n audit-liitteeksi ja on siten PYSYVÄ.
   * eSinetti torjuu henkilötunnuksen näköiset arvot (`hetu-guard.ts`), mutta
   * älä luota siihen: älä laita tähän mitään, mitä et halua olevan
   * asiakirjassa ikuisesti.
   */
  metadata?: Record<string, unknown>;
  reason?: string;
  retainYears?: number;
}

export interface SealDocumentResult {
  id: string;
  name: string;
  sealedSha256: string;
  pageCount: number;
  sizeBytes: number;
  retainUntil: string | null;
  /** Aikarajallinen latauslinkki. Tallenna tiedosto omaan Storageen, älä linkkiä. */
  downloadUrl: string;
}

/** Allekirjoittaja kierroksella. Pöytäkirjassa puheenjohtaja ja pöytäkirjantarkastajat. */
export interface RoundSigner {
  name: string;
  email: string;
  phone?: string;
  roleLabel?: string;
  /** Jos syntymäaika on tiedossa sopimukselta, eSinetti tarkistaa sen tunnistuksessa. */
  expectedBirthdate?: string;
  /** Pöytäkirjoissa aina `strong` (suunnitelma, osio 09). */
  authLevel?: "strong" | "light";
}

export interface RoundDocumentInput {
  name: string;
  pdfBytes: Uint8Array;
}

export interface CreateRoundInput {
  title: string;
  documents: RoundDocumentInput[];
  signers: RoundSigner[];
  /** Kaikki allekirjoittavat samaan aikaan, kun tämä on epätosi. */
  sequential?: boolean;
  expiresInDays?: number;
  /**
   * Oma tunniste, jolla kierros löytyy takaisin: `<sovellus>:<laji>:<uuid>`.
   * Webhook palauttaa tämän, ja se tarkistetaan kierrosrivin kohdetta vasten.
   */
  externalRef?: string;
  /** Lähetetäänkö kutsut heti. */
  send?: boolean;
  /** Yhtiö eSinetissä (`upsertCompany`). Tyhjä = organisaation oletusyhtiö. */
  companyId?: string;
  /**
   * Kuka pyytää allekirjoitusta. Viesteissä: "Nimi (Organisaatio) kutsui sinut
   * allekirjoittamaan". Tyhjä organisaatio = tilin lähettäjänimi.
   */
  requestedBy?: { name?: string; organization?: string };
}

export interface EsinettiCompanyInput {
  name: string;
  /** Y-tunnus. eSinetti tunnistaa yhtiön tästä, joten kutsun voi toistaa turvallisesti. */
  businessId?: string;
  externalRef?: string;
}

export interface EsinettiCompany {
  id: string;
  name: string;
  businessId: string | null;
}

export type RoundStatus =
  | "draft"
  | "sent"
  | "partially_signed"
  | "completed"
  | "cancelled"
  | "expired";

export type SignerStatus = "pending" | "opened" | "identified" | "signed" | "declined";

export interface RoundDocument {
  id: string;
  name: string;
  position: number;
  pageCount: number | null;
  sizeBytes: number | null;
  originalSha256: string | null;
  sealedSha256: string | null;
}

export interface RoundSignerState {
  id: string;
  name: string;
  email: string;
  roleLabel: string | null;
  authLevel: "strong" | "light";
  position: number;
  status: SignerStatus;
  openedAt: string | null;
  identifiedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
}

export interface Round {
  id: string;
  title: string;
  status: RoundStatus;
  sequential: boolean;
  externalRef: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  documents: RoundDocument[];
  signers: RoundSignerState[];
}

/** Julkisen `GET /verify`-haun tulos. Ei vaadi API-avainta eSinetissä. */
export type VerifyResult =
  | { found: false }
  | {
      found: true;
      document: { name: string; pageCount: number | null; sealedSha256: string; kind: string };
      round: { title: string | null; status: string | null; sealedAt: string | null } | null;
      organization: string | null;
      signers: Array<{
        name: string;
        authMethod: string | null;
        provider: string | null;
        signedAt: string | null;
        providerTransactionId: string | null;
      }>;
    };

/**
 * eSinetti-liitännän sopimus. Sekä oikea client että mock toteuttavat tämän,
 * eikä sovelluskoodi saa tietää kumpi on käytössä.
 */
export interface EsinettiClient {
  sealDocument(input: SealDocumentInput): Promise<SealDocumentResult>;
  createRound(input: CreateRoundInput): Promise<Round>;
  getRound(roundId: string): Promise<Round>;
  sendRound(roundId: string): Promise<Round>;
  remindRound(roundId: string): Promise<void>;
  cancelRound(roundId: string): Promise<Round>;
  /**
   * Kierros ulkoisella viitteellä, tai null. eSinetissä ei ole
   * `Idempotency-Key`-tukea, joten tämä on ainoa tapa huomata, että
   * edellinen yritys ehti luoda kierroksen ennen katkosta.
   */
  findRoundByExternalRef(externalRef: string): Promise<Round | null>;
  /** Luo tai päivittää yhtiön eSinetissä. Tunnistus y-tunnuksesta, joten toisto on turvallista. */
  upsertCompany(input: EsinettiCompanyInput): Promise<EsinettiCompany>;
  /** Lataa kierroksen asiakirjan tavut (sinetöity, jos kierros on valmis). */
  downloadRoundDocument(roundId: string, documentId: string): Promise<Uint8Array>;
  verifyDocument(sha256: string): Promise<VerifyResult>;
}
