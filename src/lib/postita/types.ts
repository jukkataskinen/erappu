/**
 * Postita.fi-kirjepalvelun tyypit. Rajapinta: postita.fi/intro/fi/kehittajille/
 */

/** Postitan työn tila. NE uusi (vahvistamaton), CO vahvistettu, PR käsittelyssä, SE lähetetty, CA peruttu. */
export type PostitaJobStatus = "NE" | "CO" | "PR" | "SE" | "CA";

export const POSTITA_JOB_STATUSES: readonly PostitaJobStatus[] = ["NE", "CO", "PR", "SE", "CA"];

export interface PostitaJob {
  id: string;
  status: PostitaJobStatus;
  /** Työn hinta euroina alv 0, jos Postita ilmoitti sen. */
  price: number | null;
  recipientCount: number | null;
  totalPages: number | null;
}

/** 1 = 1. luokka, 2 = 2. luokka. Värilliset luokat 3 ja 4 eivät ole käytössä: kirjeet ovat mustavalkoisia. */
export type PostClass = 1 | 2;

export interface UploadInput {
  /** Työn nimi Postitan käyttöliittymässä. Ei henkilötietoja. */
  jobName: string;
  /** Kaikki kirjeet yhtenä PDF:nä. */
  pdf: Uint8Array;
  /** Sivuja kirjettä kohden (`pdf_splitter`). Jokaisen kirjeen ensimmäisellä sivulla on osoite. */
  pagesPerLetter: number;
  letterCount: number;
  postClass: PostClass;
}

export interface PostitaClient {
  readonly mode: "mock" | "http";
  /** Lataa kirjeet vahvistamattomana työnä (`confirm=false`), jotta vedoksen voi tarkistaa. */
  upload(input: UploadInput): Promise<PostitaJob>;
  /** Vahvistaa työn postitettavaksi. Vain tila NE. */
  confirm(jobId: string): Promise<PostitaJob>;
  /** Poistaa työn ennen käsittelyä. */
  cancel(jobId: string): Promise<void>;
  jobInfo(jobId: string): Promise<PostitaJob>;
}

export type PostitaErrorCode = "not_configured" | "unauthorized" | "rejected" | "not_found" | "unavailable" | "bad_response";

/**
 * Virheviesti näytetään käyttäjälle sellaisenaan, joten siihen ei koskaan
 * kopioida Postitan vastauksen sisältöä: vastaus voi toistaa syötettä.
 */
export class PostitaError extends Error {
  constructor(
    readonly code: PostitaErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PostitaError";
  }
}

export function isPostitaError(err: unknown): err is PostitaError {
  return err instanceof PostitaError;
}

/** Kirjeen sivumäärän yläraja Postitassa. */
export const MAX_PAGES_PER_LETTER = 12;

/** Hinnat alv 0 (Jukka 25.9.2026): sisältää tulostuksen, isoikkunaisen C5-kuoren ja postimaksun. */
export const LETTER_PRICE_EUR: Record<PostClass, number> = { 1: 3.27, 2: 2.34 };
/** Ensimmäisen sivun jälkeen jokainen sivu. */
export const EXTRA_PAGE_PRICE_EUR = 0.16;

/** Arvio ennen latausta. Postitan ilmoittama hinta korvaa arvion. */
export function estimatePrice(letterCount: number, pagesPerLetter: number, postClass: PostClass): number {
  const perLetter = LETTER_PRICE_EUR[postClass] + Math.max(0, pagesPerLetter - 1) * EXTRA_PAGE_PRICE_EUR;
  return Math.round(letterCount * perLetter * 100) / 100;
}
