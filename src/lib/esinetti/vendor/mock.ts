// KONEELLISESTI KOPIOITU – älä muokkaa.
// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client
/**
 * eSinetin mock-toteutus kehitykseen ja testeihin: sama rajapinta kuin
 * oikealla clientilla, mutta mitään ei lähetetä verkkoon.
 *
 * ===========================================================================
 * MITÄ MOCK LUPAA JA MITÄ EI
 *
 * Lupaa: sama rajapinta kuin oikea client, aito avautuva PDF, tiivisteet jotka
 * muuttuvat sinetöinnissä, kierroksen tilakone joka etenee oikeassa
 * järjestyksessä, ja `verifyDocument` joka löytää sen mitä mock on sinetöinyt.
 * Näillä kokousten allekirjoituspolku etenee ilman eSinetti-tunnuksia.
 *
 * EI lupaa: mitään todistusvoimaa. Mock ei tunnista ketään, ei allekirjoita
 * eikä sinetöi. `completeMockRound()` merkitsee allekirjoitukset tehdyiksi
 * ilman, että kukaan on allekirjoittanut mitään — se on testiapuri, ei
 * toiminto. Siksi se on omassa vientilistassaan eikä osa `EsinettiClient`-
 * rajapintaa: sovelluskoodi ei voi vahingossa kutsua sitä, koska rajapinta
 * jonka takana se työskentelee ei tunne sitä.
 *
 * Tila on prosessin muistissa (globalThis, jotta Nextin kehityspalvelimen
 * moduulien uudelleenlataus ei tyhjennä sitä). Se katoaa uudelleenkäynnistyksessä
 * eikä jaetu useamman palvelininstanssin kesken — mock on kehitystä ja
 * testejä varten, ei tuotantoa.
 * ===========================================================================
 */

import { createHash, randomUUID } from "node:crypto";
import { EsinettiError } from "./errors";
import type {
  CreateRoundInput,
  EsinettiClient,
  EsinettiCompany,
  EsinettiCompanyInput,
  Round,
  RoundDocument,
  RoundSignerState,
  SealDocumentInput,
  SealDocumentResult,
  VerifyResult,
} from "./types";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Mockin "sinetöinti": merkintä tiedoston loppuun. PDF pysyy avattavana, tiiviste muuttuu. */
function sealBytes(bytes: Uint8Array, documentId: string): Uint8Array {
  const marker = Buffer.from("\n% eSinetti-mock-sinetti " + documentId + "\n", "latin1");
  return Uint8Array.from(Buffer.concat([Buffer.from(bytes), marker]));
}

interface SealedRecord {
  id: string;
  name: string;
  bytes: Uint8Array;
  sealedSha256: string;
  /** `standalone` = sinetöity ilman allekirjoittajia, sama merkitys kuin eSinetissä. */
  kind: "round" | "standalone";
  roundId: string | null;
  sealedAt: string;
}

interface RoundRecord extends Round {
  /** Asiakirjojen tavut: alkuperäinen ja sinetöity. Ei osa julkista tyyppiä. */
  bytesById: Map<string, { original: Uint8Array; sealed: Uint8Array | null }>;
}

const mockState = globalThis as unknown as {
  __esinettiClientMock?: { rounds: Map<string, RoundRecord>; sealed: Map<string, SealedRecord>; companies: Map<string, EsinettiCompany> };
};
mockState.__esinettiClientMock ??= { rounds: new Map(), sealed: new Map(), companies: new Map() };
mockState.__esinettiClientMock.companies ??= new Map();
const rounds = mockState.__esinettiClientMock.rounds;
/** Avaimena y-tunnus tai nimi — kuten eSinetin upsert. */
const companies = mockState.__esinettiClientMock.companies;
/** Avaimena sinetöity tiiviste — juuri niin kuin `GET /verify` hakee. */
const sealed = mockState.__esinettiClientMock.sealed;

/** Tyhjentää mockin tilan. Kutsu testin `beforeEach`issä, jotta testit eivät vuoda toisiinsa. */
export function resetMockEsinetti(): void {
  rounds.clear();
  sealed.clear();
  companies.clear();
}

function toPublicRound(record: RoundRecord): Round {
  // Kopio, jotta kutsuja ei voi muuttaa mockin sisäistä tilaa vahingossa.
  // `bytesById` jätetään pois: se on mockin sisuskalu, ja jos se vuotaisi
  // paluuarvoon, testi voisi vahingossa nojata kenttään jota oikeassa
  // clientissä ei ole.
  const { bytesById, ...rest } = record;
  void bytesById;
  return {
    ...rest,
    documents: record.documents.map((d) => ({ ...d })),
    signers: record.signers.map((s) => ({ ...s })),
  };
}

function requireRound(roundId: string): RoundRecord {
  const round = rounds.get(roundId);
  if (!round) throw new EsinettiError("not_found", "Allekirjoituskierrosta ei löytynyt.");
  return round;
}

export class EsinettiMockClient implements EsinettiClient {
  async sealDocument(input: SealDocumentInput): Promise<SealDocumentResult> {
    if (input.pdfBytes.length === 0) {
      throw new EsinettiError("validation_failed", "Sinetöitävä asiakirja on tyhjä.");
    }

    const id = randomUUID();
    const bytes = sealBytes(input.pdfBytes, id);
    const sealedSha256 = sha256Hex(bytes);
    const sealedAt = new Date().toISOString();

    sealed.set(sealedSha256, {
      id,
      name: input.name,
      bytes,
      sealedSha256,
      kind: "standalone",
      roundId: null,
      sealedAt,
    });

    const retainUntil = input.retainYears
      ? new Date(Date.now() + input.retainYears * 365 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    return {
      id,
      name: input.name,
      sealedSha256,
      pageCount: 1,
      sizeBytes: bytes.length,
      retainUntil,
      // data:-URL, jotta sovelluskoodi voi hakea tavut samalla `fetch`illä
      // kuin oikeassa maailmassa. Mockin PDF:t ovat pieniä, joten tämä ei
      // kasva ongelmaksi.
      downloadUrl: "data:application/pdf;base64," + Buffer.from(bytes).toString("base64"),
    };
  }

  async createRound(input: CreateRoundInput): Promise<Round> {
    if (input.documents.length === 0) {
      throw new EsinettiError("validation_failed", "Vähintään yksi asiakirja vaaditaan.");
    }
    if (input.signers.length === 0) {
      throw new EsinettiError("validation_failed", "Vähintään yksi allekirjoittaja vaaditaan.");
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const bytesById = new Map<string, { original: Uint8Array; sealed: Uint8Array | null }>();

    const documents: RoundDocument[] = input.documents.map((doc, index) => {
      const documentId = randomUUID();
      bytesById.set(documentId, { original: doc.pdfBytes, sealed: null });
      return {
        id: documentId,
        name: doc.name,
        position: index,
        pageCount: 1,
        sizeBytes: doc.pdfBytes.length,
        originalSha256: sha256Hex(doc.pdfBytes),
        sealedSha256: null,
      };
    });

    const signers: RoundSignerState[] = input.signers.map((signer, index) => ({
      id: randomUUID(),
      name: signer.name,
      email: signer.email,
      roleLabel: signer.roleLabel ?? null,
      authLevel: signer.authLevel ?? "strong",
      position: index,
      status: "pending",
      openedAt: null,
      identifiedAt: null,
      signedAt: null,
      declinedAt: null,
    }));

    const expiresInDays = input.expiresInDays ?? 30;

    const record: RoundRecord = {
      id,
      title: input.title,
      status: input.send ? "sent" : "draft",
      sequential: input.sequential ?? false,
      externalRef: input.externalRef ?? null,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      createdAt,
      documents,
      signers,
      bytesById,
    };

    rounds.set(id, record);
    return toPublicRound(record);
  }

  async upsertCompany(input: EsinettiCompanyInput): Promise<EsinettiCompany> {
    if (!input.name.trim()) throw new EsinettiError("validation_failed", "Yhtiön nimi vaaditaan.");
    const key = input.businessId?.trim() || `name:${input.name.trim()}`;
    const existing = companies.get(key);
    const company: EsinettiCompany = { id: existing?.id ?? randomUUID(), name: input.name, businessId: input.businessId ?? null };
    companies.set(key, company);
    return company;
  }

  async findRoundByExternalRef(externalRef: string): Promise<Round | null> {
    const matching = [...rounds.values()]
      .filter((r) => r.externalRef === externalRef && r.status !== "cancelled" && r.status !== "expired")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matching[0] ? toPublicRound(matching[0]) : null;
  }

  async getRound(roundId: string): Promise<Round> {
    return toPublicRound(requireRound(roundId));
  }

  async sendRound(roundId: string): Promise<Round> {
    const round = requireRound(roundId);
    if (round.status !== "draft") {
      throw new EsinettiError("conflict", "Kierros on jo lähetetty.");
    }
    round.status = "sent";
    return toPublicRound(round);
  }

  async remindRound(roundId: string): Promise<void> {
    const round = requireRound(roundId);
    if (round.status !== "sent" && round.status !== "partially_signed") {
      throw new EsinettiError("conflict", "Muistutusta ei voi lähettää tässä tilassa.");
    }
  }

  async cancelRound(roundId: string): Promise<Round> {
    const round = requireRound(roundId);
    if (round.status === "completed") {
      throw new EsinettiError("conflict", "Valmista kierrosta ei voi perua.");
    }
    round.status = "cancelled";
    return toPublicRound(round);
  }

  async downloadRoundDocument(roundId: string, documentId: string): Promise<Uint8Array> {
    const round = requireRound(roundId);
    const bytes = round.bytesById.get(documentId);
    if (!bytes) throw new EsinettiError("not_found", "Asiakirjaa ei löytynyt.");
    // Sinetöity, jos se on olemassa — muuten alkuperäinen. Sama sääntö kuin
    // eSinetissä: sinetöityä ei ole ennen kuin kierros on valmis.
    return bytes.sealed ?? bytes.original;
  }

  async verifyDocument(sha256: string): Promise<VerifyResult> {
    const record = sealed.get(sha256.toLowerCase());
    if (!record) return { found: false };

    const round = record.roundId ? rounds.get(record.roundId) : null;

    return {
      found: true,
      document: {
        name: record.name,
        pageCount: 1,
        sealedSha256: record.sealedSha256,
        kind: record.kind,
      },
      round: round
        ? { title: round.title, status: round.status, sealedAt: round.completedAt }
        : null,
      organization: "eSinetti (mock)",
      signers: round
        ? round.signers
            .filter((s) => s.status === "signed")
            .map((s) => ({
              name: s.name,
              authMethod: "mock",
              provider: "mock",
              signedAt: s.signedAt,
              providerTransactionId: "mock-" + s.id,
            }))
        : [],
    };
  }
}

// ---------------------------------------------------------------------------
// Testiapurit. EIVÄT ole osa `EsinettiClient`-rajapintaa — ks. tiedoston
// alun selitys siitä, miksi tämä ero on tärkeä.

/** Merkitsee yhden allekirjoittajan avanneeksi ja tunnistautuneeksi. */
export function markMockSignerIdentified(roundId: string, signerId: string): void {
  const round = requireRound(roundId);
  const signer = round.signers.find((s) => s.id === signerId);
  if (!signer) throw new EsinettiError("not_found", "Allekirjoittajaa ei löytynyt.");
  const now = new Date().toISOString();
  signer.openedAt ??= now;
  signer.identifiedAt ??= now;
  signer.status = "identified";
}

/**
 * Merkitsee yhden allekirjoittajan allekirjoittaneeksi. Kun kaikki ovat
 * allekirjoittaneet, kierros valmistuu ja asiakirjat "sinetöidään" — sama
 * järjestys kuin oikeassa eSinetissä, jotta e2e-testi testaa oikeaa polkua.
 */
export function signMockRound(roundId: string, signerId: string): Round {
  const round = requireRound(roundId);
  if (round.status === "cancelled" || round.status === "expired") {
    throw new EsinettiError("conflict", "Kierros ei ole avoinna.");
  }
  const signer = round.signers.find((s) => s.id === signerId);
  if (!signer) throw new EsinettiError("not_found", "Allekirjoittajaa ei löytynyt.");

  const now = new Date().toISOString();
  signer.openedAt ??= now;
  signer.identifiedAt ??= now;
  signer.signedAt = now;
  signer.status = "signed";

  const allSigned = round.signers.every((s) => s.status === "signed");
  round.status = allSigned ? "completed" : "partially_signed";

  if (allSigned) {
    round.completedAt = now;
    for (const doc of round.documents) {
      const bytes = round.bytesById.get(doc.id);
      if (!bytes) continue;
      const sealedBytes = sealBytes(bytes.original, doc.id);
      bytes.sealed = sealedBytes;
      doc.sealedSha256 = sha256Hex(sealedBytes);
      sealed.set(doc.sealedSha256, {
        id: doc.id,
        name: doc.name,
        bytes: sealedBytes,
        sealedSha256: doc.sealedSha256,
        kind: "round",
        roundId: round.id,
        sealedAt: now,
      });
    }
  }

  return toPublicRound(round);
}

/** Allekirjoittaa kierroksen kaikkien osapuolten puolesta kerralla. */
export function completeMockRound(roundId: string): Round {
  const round = requireRound(roundId);
  let result = toPublicRound(round);
  for (const signer of [...round.signers]) {
    result = signMockRound(roundId, signer.id);
  }
  return result;
}
