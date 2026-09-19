import "server-only";
import https from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { stripPersonalIds, type HtjClient } from "./client";
import {
  HtjError,
  type HtjCallMeta,
  type HtjCompany,
  type HtjOwner,
  type HtjRestriction,
  type HtjShareGroup,
  type HtjShareGroupKind,
  type HtjSubmissionKind,
  type HtjSubmitResult,
} from "./types";

/**
 * Maanmittauslaitoksen HTJ-kyselypalvelun asiakas (järjestelmälupa).
 *
 * Lähde: MML:n tekninen kuvaus "Huoneistotietojen kyselypalvelu
 * isännöintijärjestelmille (REST)" ja skeemat 3.9.2026. Kutsut ovat
 * GET-pyyntöjä osoitteeseen https://htj-ext.nls.fi/htj1/isannointi/v1
 * (koeympäristö htj-ext-koe.nls.fi). Kutsuva järjestelmä tunnistetaan
 * mTLS-varmenteella, ja pakollinen otsake `htj-isannointitaho` kertoo
 * isännöintitahon Y-tunnuksen. Yhtiökohtainen oikeus tulee järjestelmäluvasta,
 * jonka isännöitsijä antaa Suomi.fi-tunnistuksella (erillinen ohje, kesken).
 *
 * Todettu koeympäristössä 19.9.2026: varmenne kelpaa, ilman otsaketta
 * vastaus on 400 "Required header 'htj-isannointitaho'", otsakkeen kanssa
 * 403 "Access denied", koska järjestelmälupaa ei vielä ole.
 *
 * Tietoturva: varmenne ja avain luetaan ympäristömuuttujista (tuotanto) tai
 * git-ohitetusta tiedostosta (paikallinen koekäyttö). Vastausten sisältöä ei
 * koskaan kirjoiteta lokiin eikä virheviesteihin, koska se sisältää
 * henkilötietoja. Omistajista käytetään suppeaa hakua; henkilötunnusta ei
 * lueta vastauksesta lainkaan.
 */

export interface MmlConfig {
  baseUrl: string;
  cert: Buffer;
  key: Buffer;
  passphrase?: string;
  ca?: Buffer;
  /** Isännöintitahon Y-tunnus (otsake htj-isannointitaho). */
  managerBusinessId: string;
  timeoutMs: number;
}

function pem(env: NodeJS.ProcessEnv, base64Var: string, fileVar: string): Buffer | null {
  const b64 = env[base64Var];
  if (b64) return Buffer.from(b64, "base64");
  const file = env[fileVar];
  if (file) {
    try {
      return readFileSync(file);
    } catch {
      throw new HtjError(`HTJ-varmennetiedostoa ei voitu lukea (${fileVar}).`, "config");
    }
  }
  return null;
}

export function mmlConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MmlConfig {
  const cert = pem(env, "HTJ_CLIENT_CERT_BASE64", "HTJ_CLIENT_CERT_FILE");
  const key = pem(env, "HTJ_CLIENT_KEY_BASE64", "HTJ_CLIENT_KEY_FILE");
  if (!cert || !key) throw new HtjError("HTJ-varmenne puuttuu (HTJ_CLIENT_CERT_BASE64 ja HTJ_CLIENT_KEY_BASE64 tai *_FILE).", "config");
  const managerBusinessId = (env.HTJ_ISANNOINTITAHO ?? "").trim();
  if (!/^\d{7}-\d$/.test(managerBusinessId)) throw new HtjError("HTJ_ISANNOINTITAHO puuttuu (isännöintiyrityksen Y-tunnus).", "config");
  return {
    baseUrl: (env.HTJ_BASE_URL || "https://htj-ext.nls.fi/htj1/isannointi/v1").replace(/\/+$/, ""),
    cert,
    key,
    passphrase: env.HTJ_CLIENT_KEY_PASSPHRASE || undefined,
    ca: env.HTJ_CA_BASE64 ? Buffer.from(env.HTJ_CA_BASE64, "base64") : undefined,
    managerBusinessId,
    timeoutMs: Number(env.HTJ_TIMEOUT_MS || 20_000),
  };
}

const enc = encodeURIComponent;
export const PATHS = {
  company: (bid: string) => `/yhtiot/${enc(bid)}/perustiedot`,
  shareGroups: (bid: string) => `/yhtiot/${enc(bid)}/osakeryhmat/suppeat-tiedot`,
  shareGroup: (bid: string, gid: string) => `/yhtiot/${enc(bid)}/osakeryhmat/${enc(gid)}/perustiedot`,
  premises: (bid: string, gid: string) => `/yhtiot/${enc(bid)}/osakeryhmat/${enc(gid)}/hallintakohteet`,
  owners: (bid: string, gid: string) => `/yhtiot/${enc(bid)}/osakeryhmat/${enc(gid)}/omistajat-suppea`,
  restrictions: (bid: string, gid: string) => `/yhtiot/${enc(bid)}/osakeryhmat/${enc(gid)}/rajoitukset-suppea`,
  // TODO(MML-skeema): ylläpitopalvelulla on oma perusosoite ja kuvaus (HTJ2-dokumentaatio Teamsissa).
  submit: (bid: string, kind: HtjSubmissionKind) => `/yllapito/taloyhtiot/${enc(bid)}/${SUBMIT_SEGMENT[kind]}`,
};

const SUBMIT_SEGMENT: Record<HtjSubmissionKind, string> = {
  charges: "vastikkeet",
  loans: "yhtiolainat",
  loan_shares: "lainaosuudet",
  maintenance_works: "kunnossapito-ja-muutostyot",
  maintenance_needs: "kunnossapitotarveselvitys",
};

/**
 * Otsakkeet. `htj-isannointitaho` on pakollinen. Pyyntötunniste auttaa
 * MML:n tukea jäljittämään kutsun; käyttäjä ei välity MML:lle.
 * TODO(MML-järjestelmälupa): käyttäjäkohtainen lupa-otsake, kun ohje saadaan.
 */
export function mmlHeaders(config: Pick<MmlConfig, "managerBusinessId">, requestId = randomUUID()): Record<string, string> {
  return {
    Accept: "application/json",
    "htj-isannointitaho": config.managerBusinessId,
    "X-Request-ID": requestId,
  };
}

interface RawResponse {
  status: number;
  body: string;
}

function request(config: MmlConfig, agent: https.Agent, method: "GET" | "POST", path: string, body?: unknown): Promise<RawResponse> {
  const url = new URL(config.baseUrl + path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = mmlHeaders(config);
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
// Muuntimet (skeemat 3.9.2026). Uusia kenttiä voi tulla; tuntemattomat ohitetaan.
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);
const code = (v: unknown): string | null => str(obj(v).koodi);
const finnishName = (v: unknown): string | null => {
  const names = arr(obj(v).nimet);
  return str((names.find((n) => n.kieli === "fi") ?? names[0])?.nimi);
};

/** Yhtiön perustiedot. Osoitetta ei ole yhtiötasolla; kotipaikka tallennetaan kaupungiksi. */
export function mapCompany(j: Json): HtjCompany {
  const form = code(j.yritysmuoto);
  return {
    htjId: str(j.ytunnus) ?? "",
    businessId: str(j.ytunnus) ?? "",
    name: str(j.paatoiminimi) ?? "",
    companyForm: form === "AOY" ? "asunto_oy" : form === "KKOY" ? "koy" : "other",
    streetAddress: null,
    postalCode: null,
    city: finnishName(j.kotipaikka),
    totalShares: null,
    articlesDate: null,
    shareRegisterTransferred: j.osakeluetteloOsakehuoneistorekisterissa === true,
  };
}

/** Osakeryhmän tila: 1 voimassa, 2 lakannut, 3 syntyvä, 4 lakkaava. Lakanneita ei tuoda. */
export function isActiveShareGroup(j: Json): boolean {
  return code(j.olotila) !== "2";
}

/** "1-100, 151-160" → osakevälit. */
export function parseShareRanges(text: string | null): { first: number; last: number }[] {
  if (!text) return [];
  return text
    .split(/[,;]/)
    .map((p) => p.trim().match(/^(\d+)\s*-\s*(\d+)$|^(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => (m[3] ? { first: Number(m[3]), last: Number(m[3]) } : { first: Number(m[1]), last: Number(m[2]) }))
    .filter((r) => r.first > 0 && r.last >= r.first);
}

/** Huoneiston käyttötarkoitus (KAYTTOTARKOITUS_HUONEISTO): 1 asuin, 2 liike, 4 autopaikka, 19 varasto. */
function premisesKind(type: string | null, use: string | null): HtjShareGroupKind {
  if (type === "A" || use === "4") return "parking";
  if (type === "M") return use === "19" ? "storage" : "other";
  if (use === "1") return "apartment";
  if (use === "2" || use === "50" || use === "52" || use === "59") return "commercial";
  if (use === "19") return "storage";
  return type === "H" ? "apartment" : "other";
}

/**
 * Osakeryhmä suppeista tiedoista, perustiedoista ja hallintakohteista.
 * Tunnukseksi osakeryhmänimi (esim. "A 1"). Pinta-alaksi huoneistoala
 * (PINTAALATYYPPI 1) tai ensimmäinen ilmoitettu.
 */
export function mapShareGroup(summary: Json, details: Json | null, premises: Json | null): HtjShareGroup {
  const d = details ?? {};
  const ranges = arr(d.osakesarjat).length
    ? arr(d.osakesarjat).map((s) => ({ first: num(s.alkunumero) ?? 0, last: num(s.loppunumero) ?? 0 })).filter((r) => r.first > 0 && r.last >= r.first)
    : parseShareRanges(str(d.osakkeet) ?? str(summary.osakkeet));
  const targets = arr(obj(premises).hallintakohteet);
  const main = targets.find((t) => t.paahallintakohde === true) ?? targets[0] ?? {};
  const areas = arr(main.pintaalat);
  const area = areas.find((a) => code(a.pintaalanTyyppi) === "1") ?? areas[0];
  return {
    htjId: str(summary.osakeryhmatunnus) ?? str(d.osakeryhmatunnus) ?? "",
    unitLabel: str(summary.osakeryhmanimi) ?? str(d.osakeryhmanimi) ?? str(main.tunnus) ?? "",
    ranges,
    shareCount: num(summary.osakelukumaara) ?? num(d.osakelukumaara) ?? ranges.reduce((s, r) => s + r.last - r.first + 1, 0),
    kind: premisesKind(code(main.hallintakohdetyyppi) ?? code(d.hallintakohdetyyppi), code(obj(main.paakayttotarkoitus).kayttotarkoitus) ?? code(obj(d.paakayttotarkoitus).kayttotarkoitus)),
    areaM2: area ? num(area.pintaala) : null,
    intendedUse: str(obj(main.paakayttotarkoitus).selite),
    layout: str(main.huoneistotyyppi),
    floor: str(main.sijaintikerros),
  };
}

/** Omistusoikeuden tila (HALLINTAOIKEUS_TILA): 2 voimaan tuleva, 3 voimassa. Vireillä olevia ei tuoda. */
const CURRENT_OWNERSHIP = new Set(["3"]);

/**
 * Omistajat suppeasta hausta. HTJ ei anna omistajalle pysyvää tunnistetta,
 * joten viite muodostetaan tiivisteenä nimestä ja syntymäajasta tai
 * Y-tunnuksesta (ei henkilötunnuksesta).
 */
export function mapOwners(j: Json, shareGroupHtjId: string): HtjOwner[] {
  const out: HtjOwner[] = [];
  for (const right of arr(j.omistusoikeudet)) {
    for (const o of arr(right.omistajat)) {
      const tila = code(o.omistusoikeudenTila);
      if (tila && !CURRENT_OWNERSHIP.has(tila)) continue;
      const h = obj(o.henkilonTiedot);
      const company = str(h.toiminimi);
      const first = str(h.etunimet);
      const last = str(h.sukunimi);
      const name = company ?? [first, last].filter(Boolean).join(" ");
      const ref = createHash("sha256").update(`htj-owner:${company ? `y:${str(h.ytunnus) ?? str(h.rekisterinumero) ?? company}` : `p:${last}|${first}|${str(h.syntymapvm) ?? ""}`}`).digest("hex").slice(0, 32);
      const share = obj(o.omistusosuus);
      out.push({
        htjId: createHash("sha256").update(`${shareGroupHtjId}:${ref}:${out.length}`).digest("hex").slice(0, 32),
        ownerRef: ref,
        shareGroupHtjId,
        kind: company ? "company" : h.kuolinpesa === true ? "estate" : "person",
        name,
        firstNames: company ? null : first,
        lastName: company ? null : last,
        companyName: company,
        businessId: company ? str(h.ytunnus) : null,
        birthDate: company ? null : str(h.syntymapvm),
        shareFraction: { numerator: num(share.omistusosuusOsoittaja) ?? 1, denominator: num(share.omistusosuusNimittaja) ?? 1 },
        startsOn: str(o.alkamispvm)?.slice(0, 10) ?? null,
        protected: h.luovutuskielto === true,
        contact: null,
      });
    }
  }
  return out;
}

/** Rajoitukset: kaikki palautetut (vireillä, voimassa, ei lainvoimaiset). Laji on RAJOITUSLAJI-koodi. */
export function mapRestrictions(j: Json, shareGroupHtjId: string): HtjRestriction[] {
  return arr(j.rajoitukset).map((r) => ({
    shareGroupHtjId,
    kind: code(r.rajoituslaji) ?? "1",
    description: str(r.vapaaehtoinenSelite),
    registeredOn: str(r.alkamispvm)?.slice(0, 10) ?? str(r.tapahtumapvm)?.slice(0, 10) ?? null,
  }));
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
  const get = async (path: string, allowNotFound = false) => ensureOk(await request(config, agent, "GET", path), allowNotFound);
  const activeGroups = async (bid: string) => arr(await get(PATHS.shareGroups(bid))).filter(isActiveShareGroup);

  return {
    mode: "mml",
    getCompany: (bid) =>
      timed("company", async () => {
        const json = await get(PATHS.company(bid), true);
        return json ? mapCompany(obj(json)) : null;
      }),
    listShareGroups: (bid) =>
      timed("share_groups", async () => {
        const out: HtjShareGroup[] = [];
        for (const g of await activeGroups(bid)) {
          const gid = str(g.osakeryhmatunnus);
          if (!gid) continue;
          const details = obj(await get(PATHS.shareGroup(bid, gid), true));
          const premises = obj(await get(PATHS.premises(bid, gid), true));
          out.push(mapShareGroup(g, details, premises));
        }
        return out;
      }),
    listOwners: (bid, scope) =>
      timed("owners", async () => {
        // Laajaa hakua (henkilötunnukset) ei käytetä: eRappu ei tallenna tunnuksia.
        if (scope === "wide") throw new HtjError("Laaja omistajahaku ei ole käytössä.", "config");
        const out: HtjOwner[] = [];
        for (const g of await activeGroups(bid)) {
          const gid = str(g.osakeryhmatunnus);
          if (gid) out.push(...mapOwners(obj(await get(PATHS.owners(bid, gid), true)), gid));
        }
        return stripPersonalIds(out);
      }),
    listRestrictions: (bid) =>
      timed("restrictions", async () => {
        const out: HtjRestriction[] = [];
        for (const g of await activeGroups(bid)) {
          const gid = str(g.osakeryhmatunnus);
          if (gid) out.push(...mapRestrictions(obj(await get(PATHS.restrictions(bid, gid), true)), gid));
        }
        return out;
      }),
    listChanges: () =>
      timed("changes", async () => {
        // Muutostiedot siirtyvät uuteen muutostietopalveluun (MML: "Huoneistotietojen
        // muutostietopalvelu isännöintijärjestelmille"). TODO(MML-skeema): kytketään, kun kuvaus saadaan.
        throw new HtjError("HTJ:n muutostietopalvelua ei ole vielä kytketty. Päivitä yhtiö kerrallaan.", "config");
      }),
    submit: (bid, kind, payload) =>
      timed("submit", async () => {
        const res = await request(config, agent, "POST", PATHS.submit(bid, kind), payload);
        if (res.status === 400 || res.status === 422) {
          // TODO(MML-skeema): virhevastauksen rakenne. Viestit eivät sisällä henkilötietoja (ilmoitukset ovat yhtiötason tietoja).
          let messages: string[] = ["HTJ hylkäsi ilmoituksen."];
          try {
            const j = JSON.parse(res.body) as Json;
            const list = arr(j.messages).length ? arr(j.messages).map((v) => str(v.message) ?? "Tuntematon virhe") : arr(j.virheet).map((v) => str(v.viesti) ?? "Tuntematon virhe");
            if (list.length) messages = list.slice(0, 20);
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

/** Yhteystesti: palauttaa vain HTTP-tilan ja MML:n virheviestin, ei tietosisältöä. */
export async function mmlConnectionCheck(businessId: string, config: MmlConfig = mmlConfigFromEnv()): Promise<{ status: number; message: string | null }> {
  const agent = new https.Agent({ cert: config.cert, key: config.key, passphrase: config.passphrase, ca: config.ca, minVersion: "TLSv1.2" });
  const res = await request(config, agent, "GET", PATHS.company(businessId));
  agent.destroy();
  let message: string | null = null;
  if (res.status >= 400) {
    try {
      const j = JSON.parse(res.body) as Json;
      message = str(j.message) ?? str(arr(j.messages)[0]?.message);
    } catch {
      message = null;
    }
  }
  return { status: res.status, message };
}
