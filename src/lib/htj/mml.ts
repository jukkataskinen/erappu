import "server-only";
import https from "node:https";
import { randomUUID, createHash } from "node:crypto";
import { stripPersonalIds, type HtjClient } from "./client";
import {
  HtjError,
  type HtjCallMeta,
  type HtjChange,
  type HtjCompany,
  type HtjOwner,
  type HtjRestriction,
  type HtjShareGroup,
  type HtjShareGroupKind,
  type HtjSubmissionKind,
  type HtjSubmitResult,
} from "./types";

/**
 * Maanmittauslaitoksen HTJ-rajapinnan asiakas (runko).
 *
 * Tunnetut asiat (MML:n sivut 14.9.2026): kyselypalvelu on REST-rajapinta
 * osoitteessa https://htj-ext.nls.fi/htj1/isannointi/v1 (GET), ylläpitopalvelu
 * ottaa vastaan ilmoitukset, yhteys vaatii mTLS-varmenteen, pakolliset
 * HTTP-otsakkeet ja hakujen lokituksen, ja isännöitsijä antaa järjestelmäluvan
 * Suomi.fi-tunnistuksella (jarjestelmalupa.nls.fi).
 *
 * Tuntemattomat asiat: polut, otsakkeiden nimet ja JSON-skeemat. Ne on
 * merkitty `TODO(MML-skeema)`, ja ne kytketään, kun testiympäristö ja
 * OpenAPI-kuvaus saadaan (BLOCKERS 1). Tätä tiedostoa ei ajeta testeissä.
 *
 * Tietoturva: varmenne ja avain luetaan ympäristömuuttujista eikä niitä
 * kirjoiteta levylle. Vastausten sisältöä ei koskaan kirjoiteta lokiin eikä
 * virheviesteihin, koska se sisältää henkilötietoja.
 */

export interface MmlConfig {
  baseUrl: string;
  cert: Buffer;
  key: Buffer;
  passphrase?: string;
  ca?: Buffer;
  systemId: string;
  timeoutMs: number;
}

export function mmlConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MmlConfig {
  const cert = env.HTJ_CLIENT_CERT_BASE64;
  const key = env.HTJ_CLIENT_KEY_BASE64;
  if (!cert || !key) throw new HtjError("HTJ-varmenne puuttuu (HTJ_CLIENT_CERT_BASE64, HTJ_CLIENT_KEY_BASE64).", "config");
  return {
    baseUrl: (env.HTJ_BASE_URL || "https://htj-ext.nls.fi/htj1/isannointi/v1").replace(/\/+$/, ""),
    cert: Buffer.from(cert, "base64"),
    key: Buffer.from(key, "base64"),
    passphrase: env.HTJ_CLIENT_KEY_PASSPHRASE || undefined,
    ca: env.HTJ_CA_BASE64 ? Buffer.from(env.HTJ_CA_BASE64, "base64") : undefined,
    systemId: env.HTJ_SYSTEM_ID || "erappu",
    timeoutMs: Number(env.HTJ_TIMEOUT_MS || 20_000),
  };
}

// TODO(MML-skeema): polut arvattu kyselypalvelun kuvauksen perusteella.
const PATHS = {
  company: (bid: string) => `/taloyhtiot/${encodeURIComponent(bid)}`,
  shareGroups: (bid: string) => `/taloyhtiot/${encodeURIComponent(bid)}/osakeryhmat`,
  owners: (bid: string, scope: "narrow" | "wide") => `/taloyhtiot/${encodeURIComponent(bid)}/omistajat?laajuus=${scope === "wide" ? "laaja" : "suppea"}`,
  restrictions: (bid: string) => `/taloyhtiot/${encodeURIComponent(bid)}/rajoitukset`,
  changes: (since: Date) => `/muutokset?alkaen=${encodeURIComponent(since.toISOString())}`,
  // TODO(MML-skeema): ylläpitopalvelulla on oma perusosoite ja OpenAPI-kuvaus.
  submit: (bid: string, kind: HtjSubmissionKind) => `/yllapito/taloyhtiot/${encodeURIComponent(bid)}/${SUBMIT_SEGMENT[kind]}`,
};

const SUBMIT_SEGMENT: Record<HtjSubmissionKind, string> = {
  charges: "vastikkeet",
  loans: "yhtiolainat",
  loan_shares: "lainaosuudet",
  maintenance_works: "kunnossapito-ja-muutostyot",
  maintenance_needs: "kunnossapitotarveselvitys",
};

/**
 * Pakolliset otsakkeet. TODO(MML-skeema): nimet ja sisältö tarkistetaan
 * MML:n teknisestä kuvauksesta. Käyttäjä välitetään pseudonyyminä, ei
 * sähköpostina eikä nimenä.
 */
export function mmlHeaders(config: Pick<MmlConfig, "systemId">, meta: HtjCallMeta, requestId = randomUUID()): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Request-ID": requestId,
    "X-Client-System": config.systemId,
    "X-Purpose": meta.purpose,
    "X-End-User": meta.userId ? createHash("sha256").update(`erappu:${meta.userId}`).digest("hex").slice(0, 32) : "scheduled-job",
  };
}

interface RawResponse {
  status: number;
  body: string;
}

function request(config: MmlConfig, agent: https.Agent, method: "GET" | "POST", path: string, meta: HtjCallMeta, body?: unknown): Promise<RawResponse> {
  const url = new URL(config.baseUrl + path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = mmlHeaders(config, meta);
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, agent, headers, timeout: config.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => reject(new HtjError("HTJ-yhteys katkesi.", "network")));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new HtjError("HTJ-palveluun ei saatu yhteyttä.", "network")));
    if (payload) req.write(payload);
    req.end();
  });
}

function ensureOk(res: RawResponse, allowNotFound = false): unknown | null {
  if (res.status === 404 && allowNotFound) return null;
  if (res.status === 401 || res.status === 403) throw new HtjError("HTJ hylkäsi tunnistautumisen tai järjestelmälupa puuttuu.", "auth", res.status);
  if (res.status === 404) throw new HtjError("Tietoa ei löytynyt HTJ:stä.", "not_found", res.status);
  if (res.status === 429) throw new HtjError("HTJ:n pyyntöraja ylittyi. Yritä myöhemmin.", "rate_limited", res.status);
  if (res.status >= 500) throw new HtjError("HTJ-palvelussa on häiriö.", "server", res.status);
  if (res.status < 200 || res.status >= 300) throw new HtjError("HTJ palautti odottamattoman vastauksen.", "invalid_response", res.status);
  try {
    return res.body ? JSON.parse(res.body) : {};
  } catch {
    throw new HtjError("HTJ:n vastausta ei voitu lukea.", "invalid_response", res.status);
  }
}

// ---------------------------------------------------------------------------
// Muuntimet. TODO(MML-skeema): kaikki kenttänimet ovat arvauksia.
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

export function mapCompany(j: Json): HtjCompany {
  const osoite = (j.osoite ?? {}) as Json;
  return {
    htjId: str(j.id) ?? str(j.yhtioTunnus) ?? str(j.ytunnus) ?? "",
    businessId: str(j.ytunnus) ?? "",
    name: str(j.nimi) ?? "",
    companyForm: j.yhtiomuoto === "KOY" ? "koy" : j.yhtiomuoto === "AOY" || j.yhtiomuoto === undefined ? "asunto_oy" : "other",
    streetAddress: str(osoite.katuosoite),
    postalCode: str(osoite.postinumero),
    city: str(osoite.postitoimipaikka),
    totalShares: num(j.osakkeidenLukumaara),
    articlesDate: str(j.yhtiojarjestyksenPaivays),
    shareRegisterTransferred: j.osakeluetteloSiirretty !== false,
  };
}

const KIND: Record<string, HtjShareGroupKind> = { ASUINHUONEISTO: "apartment", LIIKEHUONEISTO: "commercial", AUTOPAIKKA: "parking", AUTOTALLI: "garage", VARASTO: "storage" };

export function mapShareGroup(j: Json): HtjShareGroup {
  const ranges = arr(j.osakevalit).map((r) => ({ first: num(r.alku) ?? 0, last: num(r.loppu) ?? 0 })).filter((r) => r.first > 0 && r.last >= r.first);
  const tila = (j.hallittuTila ?? {}) as Json;
  return {
    htjId: str(j.id) ?? "",
    unitLabel: str(tila.tunnus) ?? str(j.tunnus) ?? "",
    ranges,
    shareCount: num(j.osakkeidenLukumaara) ?? ranges.reduce((s, r) => s + r.last - r.first + 1, 0),
    kind: KIND[String(tila.tyyppi ?? "").toUpperCase()] ?? "other",
    areaM2: num(tila.pintaAla),
    intendedUse: str(tila.kayttotarkoitus),
    layout: str(tila.huoneistotyyppi),
    floor: str(tila.kerros),
  };
}

export function mapOwner(j: Json, shareGroupHtjId: string): HtjOwner {
  const henkilo = (j.henkilo ?? null) as Json | null;
  const yhteiso = (j.yhteiso ?? null) as Json | null;
  const osoite = (j.osoite ?? null) as Json | null;
  const turvakielto = j.turvakielto === true;
  const first = henkilo ? str(henkilo.etunimet) : null;
  const last = henkilo ? str(henkilo.sukunimi) : null;
  return {
    htjId: str(j.id) ?? "",
    ownerRef: str(j.omistajaId) ?? str(henkilo?.id) ?? str(yhteiso?.id) ?? "",
    shareGroupHtjId,
    kind: yhteiso ? "company" : j.kuolinpesa === true ? "estate" : "person",
    name: yhteiso ? (str(yhteiso.nimi) ?? "") : [first, last].filter(Boolean).join(" "),
    firstNames: first,
    lastName: last,
    companyName: yhteiso ? str(yhteiso.nimi) : null,
    businessId: yhteiso ? str(yhteiso.ytunnus) : null,
    birthDate: henkilo ? str(henkilo.syntymaaika) : null,
    shareFraction: { numerator: num((j.osuus as Json | undefined)?.osoittaja) ?? 1, denominator: num((j.osuus as Json | undefined)?.nimittaja) ?? 1 },
    startsOn: str(j.alkupaiva),
    protected: turvakielto,
    contact: turvakielto || !osoite ? null : { streetAddress: str(osoite.katuosoite), postalCode: str(osoite.postinumero), city: str(osoite.postitoimipaikka), country: str(osoite.maa) },
    // Henkilötunnusta ei lueta vastauksesta lainkaan.
  };
}

export function createMmlHtjClient(config: MmlConfig = mmlConfigFromEnv()): HtjClient {
  const agent = new https.Agent({
    cert: config.cert,
    key: config.key,
    passphrase: config.passphrase,
    ca: config.ca,
    keepAlive: true,
    maxSockets: 4,
    minVersion: "TLSv1.2",
  });

  const timed = async <T>(op: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      // Vain operaatio ja kesto: ei polkua (sisältää Y-tunnuksen), ei vastausta.
      console.info(`[htj:mml] ${op} ${Date.now() - started} ms`);
    }
  };

  return {
    mode: "mml",
    getCompany: (bid, meta) =>
      timed("company", async () => {
        const json = ensureOk(await request(config, agent, "GET", PATHS.company(bid), meta), true);
        return json ? mapCompany(json as Json) : null;
      }),
    listShareGroups: (bid, meta) =>
      timed("share_groups", async () => {
        const json = ensureOk(await request(config, agent, "GET", PATHS.shareGroups(bid), meta)) as Json;
        return arr(json.osakeryhmat ?? json).map(mapShareGroup);
      }),
    listOwners: (bid, scope, meta) =>
      timed("owners", async () => {
        const json = ensureOk(await request(config, agent, "GET", PATHS.owners(bid, scope), meta)) as Json;
        // TODO(MML-skeema): omistajat voivat tulla osakeryhmien alla.
        const list = arr(json.osakeryhmat ?? json).flatMap((g) => arr(g.omistajat).map((o) => mapOwner(o, str(g.id) ?? "")));
        return stripPersonalIds(list);
      }),
    listRestrictions: (bid, meta) =>
      timed("restrictions", async () => {
        const json = ensureOk(await request(config, agent, "GET", PATHS.restrictions(bid), meta)) as Json;
        return arr(json.rajoitukset ?? json).map(
          (r): HtjRestriction => ({ shareGroupHtjId: str(r.osakeryhmaId) ?? "", kind: str(r.laji) ?? "muu", description: str(r.kuvaus), registeredOn: str(r.kirjauspaiva) }),
        );
      }),
    listChanges: (since, meta) =>
      timed("changes", async () => {
        const json = ensureOk(await request(config, agent, "GET", PATHS.changes(since), meta)) as Json;
        return arr(json.muutokset ?? json).map(
          (c): HtjChange => ({
            htjId: str(c.id) ?? "",
            businessId: str(c.ytunnus) ?? "",
            kind: c.laji === "OMISTUS" ? "ownership" : c.laji === "OSAKERYHMA" ? "share_group" : c.laji === "RAJOITUS" ? "restriction" : c.laji === "YHTIO" ? "company" : "other",
            shareGroupHtjId: str(c.osakeryhmaId),
            occurredAt: str(c.aikaleima) ?? new Date().toISOString(),
          }),
        );
      }),
    submit: (bid, kind, payload, meta) =>
      timed("submit", async () => {
        const res = await request(config, agent, "POST", PATHS.submit(bid, kind), meta, payload);
        if (res.status === 400 || res.status === 422) {
          // TODO(MML-skeema): virhevastauksen rakenne. Viestit eivät sisällä henkilötietoja (ilmoitukset ovat yhtiötason tietoja).
          let messages: string[] = ["HTJ hylkäsi ilmoituksen."];
          try {
            const j = JSON.parse(res.body) as Json;
            messages = arr(j.virheet).map((v) => str(v.viesti) ?? "Tuntematon virhe").slice(0, 20);
          } catch {
            // vastaus ei ollut JSONia
          }
          return { accepted: false, reference: null, itemRefs: {}, messages };
        }
        const json = ensureOk(res) as Json;
        const refs = Object.fromEntries(arr(json.rivit).map((r) => [str(r.omaTunniste) ?? "", str(r.htjTunniste) ?? ""]).filter(([a, b]) => a && b));
        return { accepted: true, reference: str(json.kasittelytunnus), itemRefs: refs, messages: [] } satisfies HtjSubmitResult;
      }),
  };
}
