/**
 * HTJ:n sisäinen tietomalli.
 *
 * Maanmittauslaitoksen JSON-skeemoja ei ole vielä saatavilla (BLOCKERS 1).
 * Sovellus käyttää vain näitä tyyppejä, ja `mml.ts` muuntaa rajapinnan
 * vastaukset tähän muotoon. Kun skeemat saadaan, muutokset rajautuvat
 * muuntimiin. Kentät, joiden olemassaolo tai muoto on arvaus, on merkitty
 * `TODO(MML-skeema)`.
 */

/** Suppea haku palauttaa omistajan syntymäajan, laaja myös henkilötunnuksen. */
export type HtjScope = "narrow" | "wide";

/** Hakulokiin kirjattava käyttötarkoitus (MML:n ehdot). */
export type HtjPurpose = "registry_sync" | "change_sync" | "htj2_submission" | "manager_certificate" | "meeting";

export type HtjMode = "mock" | "mml";

export interface HtjShareRange {
  first: number;
  last: number;
}

export interface HtjCompany {
  /** HTJ:n yhtiötunniste. TODO(MML-skeema): voi olla sama kuin Y-tunnus. */
  htjId: string;
  businessId: string;
  name: string;
  companyForm: "asunto_oy" | "koy" | "other";
  streetAddress: string | null;
  postalCode: string | null;
  city: string | null;
  totalShares: number | null;
  articlesDate: string | null;
  /** Onko osakeluettelo siirretty HTJ:hin. TODO(MML-skeema) */
  shareRegisterTransferred: boolean;
}

export type HtjShareGroupKind = "apartment" | "commercial" | "parking" | "garage" | "storage" | "other";

export interface HtjShareGroup {
  /** Osakeryhmän pysyvä tunniste HTJ:ssä. TODO(MML-skeema) */
  htjId: string;
  /** Huoneiston tai hallitun tilan tunnus, esim. "A 1". */
  unitLabel: string;
  ranges: HtjShareRange[];
  shareCount: number;
  kind: HtjShareGroupKind;
  areaM2: number | null;
  intendedUse: string | null;
  layout: string | null;
  floor: string | null;
}

export interface HtjShareFraction {
  numerator: number;
  denominator: number;
}

export interface HtjContact {
  streetAddress: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface HtjOwner {
  /** Omistusmerkinnän tunniste. TODO(MML-skeema) */
  htjId: string;
  /** Omistajan (henkilö tai yhteisö) pysyvä viite HTJ:ssä, ei henkilötunnus. TODO(MML-skeema) */
  ownerRef: string;
  shareGroupHtjId: string;
  kind: "person" | "company" | "estate";
  /** Näyttönimi HTJ:n muodossa. */
  name: string;
  firstNames: string | null;
  lastName: string | null;
  companyName: string | null;
  businessId: string | null;
  /** Suppea haku: syntymäaika. Ei tallenneta kantaan. */
  birthDate: string | null;
  shareFraction: HtjShareFraction;
  startsOn: string | null;
  /** VTJ-osoite. Puuttuu, jos henkilöllä on turvakielto. */
  contact?: HtjContact | null;
  /** Turvakielto: osoitetta ei saa näyttää eikä tallentaa. */
  protected?: boolean;
  /**
   * Vain laajassa haussa. Poistetaan heti rajapintakerroksessa
   * (`stripPersonalIds`), eikä se päädy lokeihin, eroihin eikä kantaan.
   */
  personalId?: string;
}

export interface HtjRestriction {
  shareGroupHtjId: string;
  /** Esim. panttaus, ulosmittaus, lunastusoikeus. TODO(MML-koodisto) */
  kind: string;
  description: string | null;
  registeredOn: string | null;
}

export type HtjChangeKind = "ownership" | "share_group" | "restriction" | "company" | "other";

export interface HtjChange {
  htjId: string;
  businessId: string;
  kind: HtjChangeKind;
  shareGroupHtjId: string | null;
  occurredAt: string;
}

export type HtjSubmissionKind = "charges" | "loans" | "loan_shares" | "maintenance_works" | "maintenance_needs";

export interface HtjSubmitResult {
  accepted: boolean;
  /** HTJ:n käsittelytunnus. TODO(MML-skeema) */
  reference: string | null;
  /** Rivikohtaiset HTJ-tunnisteet: paikallinen id → HTJ-tunniste. */
  itemRefs: Record<string, string>;
  messages: string[];
}

/** Hakuun liittyvä tieto lokia ja pakollisia otsakkeita varten. Ei henkilötietoja. */
export interface HtjCallMeta {
  purpose: HtjPurpose;
  /** Haun tekijän eRappu-tunniste (uuid) tai null ajastetulle tehtävälle. */
  userId: string | null;
  organizationId: string;
  companyId?: string | null;
  syncId?: string | null;
}

export class HtjError extends Error {
  constructor(
    message: string,
    readonly code: "config" | "network" | "auth" | "not_found" | "rate_limited" | "invalid_response" | "server" | "rejected",
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "HtjError";
  }
}
