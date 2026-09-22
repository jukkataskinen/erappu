// KONEELLISESTI KOPIOITU – älä muokkaa.
// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client
/**
 * eSinetin REST-API -client kutsuvalle järjestelmälle.
 *
 * ===========================================================================
 * TIETOTURVA
 *
 * 1. Kuka saa kutsua: vain palvelinkoodi. API-avain on organisaation
 *     pääsy kaikkiin sen asiakirjoihin, joten se ei saa päätyä
 *    selaimeen. `assertServerOnly()` kaataa heti, jos moduuli ladataan
 *    selaimessa.
 * 2. Henkilötieto: allekirjoittajan nimi ja sähköposti kulkevat eSinettiin —
 *    se on kutsun tarkoitus. Henkilötunnusta ei ole missään tyypissä eikä
 *    sitä saa lisätä.
 * 3. Syöte: tyypitetty, ja eSinetti validoi oman päänsä zodilla. Tässä ei
 *    duplikoida validointia — kaksi eri totuutta siitä mikä kelpaa olisi
 *    huonompi kuin yksi.
 * 4. Toisto: kaikki kutsut ovat joko tilattomia (render, verify) tai luovat
 *    uuden rivin (seal, rounds). Idempotenssiavainta ei ole, joten
 *    uudelleenyritys on kutsujan harkinnassa — `EsinettiError.retryable`
 *    kertoo milloin se on turvallista.
 * 5. Salaisuudet: API-avainta ei lokiteta, ei palauteta virheviestissä eikä
 *    kirjoiteta mihinkään. Virhelokissa on vain polku ja HTTP-koodi.
 * 6. Epäonnistuminen: aikakatkaisu ja verkkovirhe erotetaan palvelinvirheestä,
 *    koska niissä ei tiedetä jäikö toiminto puolitiehen.
 * 7. Lokitus: ei vastauksen sisältöä, ei otsakkeita, ei latauslinkkejä.
 * ===========================================================================
 */

import { EsinettiError, type EsinettiErrorCode } from "./errors";
import type {
  CreateRoundInput,
  EsinettiClient,
  EsinettiCompany,
  EsinettiCompanyInput,
  Round,
  SealDocumentInput,
  SealDocumentResult,
  VerifyResult,
} from "./types";

/** Pyynnön aikakatkaisu. Renderöinti ja sinetöinti ovat raskaita, mutta eivät näin raskaita. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Sama raja kuin eSinetissä (`MAX_PDF_SIZE_BYTES`). Torjutaan täällä, ettei turhaa 25 MB:n lähetystä tehdä. */
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;

export interface EsinettiHttpConfig {
  apiUrl: string;
  apiKey: string;
}

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new EsinettiError("not_configured", "eSinetti-clientia ei saa käyttää selaimessa.");
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function assertPdfSize(bytes: Uint8Array, what: string): void {
  if (bytes.length === 0) {
    throw new EsinettiError("validation_failed", what + " on tyhjä.");
  }
  if (bytes.length > MAX_PDF_SIZE_BYTES) {
    throw new EsinettiError("payload_too_large", what + " on liian suuri (enintään 25 MB).");
  }
}

const KNOWN_CODES: readonly string[] = [
  "unauthorized",
  "not_found",
  "validation_failed",
  "rate_limited",
  "conflict",
  "gone",
  "payload_too_large",
  "service_unavailable",
  "server_error",
];

/** eSinetin virhekoodit ovat samat kuin meidän, paitsi että verkkotaso lisää omansa. */
function mapErrorCode(status: number, code: unknown): EsinettiErrorCode {
  if (typeof code === "string" && KNOWN_CODES.includes(code)) {
    return code as EsinettiErrorCode;
  }
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "validation_failed";
}

export class EsinettiHttpClient implements EsinettiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: EsinettiHttpConfig) {
    assertServerOnly();
    // Loppukauttaviiva pois, jotta polkujen yhdistäminen on yksiselitteistä.
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  /**
   * Yksi HTTP-kutsu. Palauttaa jäsennetyn JSONin tai heittää `EsinettiError`in.
   *
   * `authenticated: false` on julkisille reiteille (`/verify`) — avainta ei
   * lähetetä sinne, koska sitä ei tarvita eikä salaisuuksia lähetetä
   * tarpeettomasti.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; authenticated?: boolean } = {},
  ): Promise<T> {
    const { body, authenticated = true } = options;
    const headers: Record<string, string> = { accept: "application/json" };
    if (authenticated) headers.authorization = "Bearer " + this.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      // Ei lokiteta virheoliota sellaisenaan: undici upottaa siihen URL:in,
      // ja pyynnön otsakkeet voivat olla mukana virheketjussa.
      console.error("[esinetti] " + method + " " + path + ": " + (aborted ? "timeout" : "network_error"));
      throw new EsinettiError(
        aborted ? "timeout" : "network_error",
        "Allekirjoituspalveluun ei saatu yhteyttä. Yritä hetken kuluttua uudelleen.",
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      const error = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const code = mapErrorCode(response.status, error?.code);
      const message =
        typeof error?.message === "string" && error.message.trim()
          ? error.message
          : "Allekirjoituspalvelu palautti virheen.";
      console.error("[esinetti] " + method + " " + path + ": HTTP " + response.status + " (" + code + ")");
      throw new EsinettiError(code, message);
    }

    return json as T;
  }

  async sealDocument(input: SealDocumentInput): Promise<SealDocumentResult> {
    assertPdfSize(input.pdfBytes, "Sinetöitävä asiakirja");

    const payload = await this.request<{
      id: string;
      name: string;
      sealed_sha256: string;
      page_count: number;
      size_bytes: number;
      retain_until: string | null;
      download_url: string;
    }>("POST", "/documents/seal", {
      body: {
        name: input.name,
        content_base64: toBase64(input.pdfBytes),
        metadata: input.metadata,
        reason: input.reason,
        retain_years: input.retainYears,
      },
    });

    return {
      id: payload.id,
      name: payload.name,
      sealedSha256: payload.sealed_sha256,
      pageCount: payload.page_count,
      sizeBytes: payload.size_bytes,
      retainUntil: payload.retain_until,
      downloadUrl: payload.download_url,
    };
  }

  async createRound(input: CreateRoundInput): Promise<Round> {
    for (const doc of input.documents) {
      assertPdfSize(doc.pdfBytes, 'Asiakirja "' + doc.name + '"');
    }

    const payload = await this.request<RoundWire>("POST", "/rounds", {
      body: {
        title: input.title,
        company_id: input.companyId,
        sequential: input.sequential ?? false,
        expires_in_days: input.expiresInDays,
        external_ref: input.externalRef,
        send: input.send ?? false,
        requested_by: input.requestedBy,
        documents: input.documents.map((d) => ({
          name: d.name,
          content_base64: toBase64(d.pdfBytes),
        })),
        signers: input.signers.map((s) => ({
          name: s.name,
          email: s.email,
          phone: s.phone,
          role_label: s.roleLabel,
          expected_birthdate: s.expectedBirthdate,
          // Pöytäkirjojen arvo perustuu vahvaan tunnistukseen, joten oletus
          // on `strong` eikä eSinetin oletus jää arvattavaksi.
          auth_level: s.authLevel ?? "strong",
        })),
      },
    });

    return roundFromWire(payload);
  }

  async upsertCompany(input: EsinettiCompanyInput): Promise<EsinettiCompany> {
    const payload = await this.request<{ id: string; name: string; business_id: string | null }>("POST", "/companies", {
      body: { name: input.name, business_id: input.businessId, external_ref: input.externalRef },
    });
    return { id: payload.id, name: payload.name, businessId: payload.business_id };
  }

  async findRoundByExternalRef(externalRef: string): Promise<Round | null> {
    const payload = await this.request<{ data?: RoundWire[] }>(
      "GET",
      "/rounds?external_ref=" + encodeURIComponent(externalRef),
    );
    const rounds = (payload.data ?? []).map(roundFromWire);
    // Peruttu tai vanhentunut kierros ei kelpaa uudelleenkäytettäväksi: siitä
    // ei enää synny allekirjoituksia. Uusin ensin, jotta vanha epäonnistunut
    // yritys ei voita tuoretta.
    return (
      rounds
        .filter((r) => r.status !== "cancelled" && r.status !== "expired")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async getRound(roundId: string): Promise<Round> {
    return roundFromWire(await this.request<RoundWire>("GET", "/rounds/" + roundId));
  }

  async sendRound(roundId: string): Promise<Round> {
    return roundFromWire(
      await this.request<RoundWire>("POST", "/rounds/" + roundId + "/send", { body: {} }),
    );
  }

  async remindRound(roundId: string): Promise<void> {
    await this.request<unknown>("POST", "/rounds/" + roundId + "/remind", { body: {} });
  }

  async cancelRound(roundId: string): Promise<Round> {
    return roundFromWire(
      await this.request<RoundWire>("POST", "/rounds/" + roundId + "/cancel", { body: {} }),
    );
  }

  /**
   * Lataa asiakirjan tavut.
   *
   * eSinetti vastaa 302:lla allekirjoitettuun Storage-osoitteeseen. `fetch`
   * seuraa sen oletuksena ja **pudottaa Authorization-otsakkeen** eri
   * alkuperään mennessään (fetch-spesifikaatio) — eli API-avain ei päädy
   * Storage-palvelimelle. Tätä ei saa kiertää käsin uudelleenohjausta
   * seuraamalla ja otsaketta mukana pitämällä.
   */
  async downloadRoundDocument(roundId: string, documentId: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const path = "/rounds/" + roundId + "/documents/" + documentId + "/download";

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: "GET",
        headers: { authorization: "Bearer " + this.apiKey },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      console.error("[esinetti] GET " + path + ": " + (aborted ? "timeout" : "network_error"));
      throw new EsinettiError(
        aborted ? "timeout" : "network_error",
        "Asiakirjan lataus ei onnistunut. Yritä hetken kuluttua uudelleen.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      console.error("[esinetti] GET " + path + ": HTTP " + response.status);
      throw new EsinettiError(mapErrorCode(response.status, null), "Asiakirjaa ei saatu ladattua.");
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async verifyDocument(sha256: string): Promise<VerifyResult> {
    // Julkinen reitti: API-avainta ei lähetetä.
    const payload = await this.request<VerifyWire>(
      "GET",
      "/verify?sha256=" + encodeURIComponent(sha256),
      { authenticated: false },
    );
    return verifyFromWire(payload);
  }
}

// ---------------------------------------------------------------------------
// Wire-muodon muunnokset. Nämä ovat ainoa paikka, jossa snake_case esiintyy.

interface RoundWire {
  id: string;
  title: string;
  status: Round["status"];
  sequential: boolean;
  external_ref: string | null;
  expires_at: string | null;
  completed_at: string | null;
  created_at: string;
  documents: Array<{
    id: string;
    name: string;
    position: number;
    page_count: number | null;
    size_bytes: number | null;
    original_sha256: string | null;
    sealed_sha256: string | null;
  }>;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    role_label: string | null;
    auth_level: "strong" | "light";
    position: number;
    status: Round["signers"][number]["status"];
    opened_at: string | null;
    identified_at: string | null;
    signed_at: string | null;
    declined_at: string | null;
  }>;
}

export function roundFromWire(wire: RoundWire): Round {
  return {
    id: wire.id,
    title: wire.title,
    status: wire.status,
    sequential: wire.sequential,
    externalRef: wire.external_ref,
    expiresAt: wire.expires_at,
    completedAt: wire.completed_at,
    createdAt: wire.created_at,
    documents: wire.documents.map((d) => ({
      id: d.id,
      name: d.name,
      position: d.position,
      pageCount: d.page_count,
      sizeBytes: d.size_bytes,
      originalSha256: d.original_sha256,
      sealedSha256: d.sealed_sha256,
    })),
    signers: wire.signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      roleLabel: s.role_label,
      authLevel: s.auth_level,
      position: s.position,
      status: s.status,
      openedAt: s.opened_at,
      identifiedAt: s.identified_at,
      signedAt: s.signed_at,
      declinedAt: s.declined_at,
    })),
  };
}

interface VerifyWire {
  found: boolean;
  document?: { name: string; page_count: number | null; sealed_sha256: string; kind: string };
  round?: { title: string | null; status: string | null; sealed_at: string | null } | null;
  organization?: string | null;
  signers?: Array<{
    name: string;
    auth_method: string | null;
    provider: string | null;
    signed_at: string | null;
    provider_transaction_id: string | null;
  }>;
}

export function verifyFromWire(wire: VerifyWire): VerifyResult {
  if (!wire.found || !wire.document) return { found: false };
  return {
    found: true,
    document: {
      name: wire.document.name,
      pageCount: wire.document.page_count,
      sealedSha256: wire.document.sealed_sha256,
      kind: wire.document.kind,
    },
    round: wire.round
      ? { title: wire.round.title, status: wire.round.status, sealedAt: wire.round.sealed_at }
      : null,
    organization: wire.organization ?? null,
    signers: (wire.signers ?? []).map((s) => ({
      name: s.name,
      authMethod: s.auth_method,
      provider: s.provider,
      signedAt: s.signed_at,
      providerTransactionId: s.provider_transaction_id,
    })),
  };
}
