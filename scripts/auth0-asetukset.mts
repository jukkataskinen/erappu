/**
 * eRapun Auth0-tenantin asetukset Management API:n kautta.
 *
 * ===========================================================================
 * MIKSI SKRIPTI EIKÄ KLIKKAILU
 *
 * Klikkailtu asetus ei ole toistettavissa eikä tarkistettavissa: puolen vuoden
 * päästä kukaan ei muista mitä ruudulla oli valittuna. Tämä tiedosto on
 * versionhallinnassa. Pohja on Reilusopparin asetusskripti, sovitettuna
 * eRapun kahteen käyttäjäryhmään (auth0/AJO-OHJE.md).
 *
 * EI TEE MITÄÄN ILMAN `--aja`
 *
 * Oletuksena skripti lukee tenantin tilan ja tulostaa, mitä se muuttaisi.
 *
 * KIELTÄYTYY AJAMASTA VÄÄRÄÄN TENANTTIIN
 *
 * Ennen mitään kirjoitusta skripti listaa tenantin sovellukset. Jos siellä on
 * muita kuin eRappu, Asetusskripti ja Auth0:n omat, se pysähtyy ja näyttää
 * nimet. Sama kutsu, joka asettaa eRapun tenantin oikein, lisäisi toisen
 * tenantin kirjautumiseen MFA-säännön ja vaihtaisi sen kirjautumissivun nimen.
 *
 * SALAISUUKSIA EI TULOSTETA
 *
 * Client secret kirjoitetaan `.env.local`:iin ja `--vercel`-lipulla Vercelin
 * tuotantoympäristöön stdinin kautta. Ruudulle tulee vain nimet.
 *
 * Aja pääkansiossa:
 *   npm run auth0:asetukset                          kuivaharjoitus
 *   npm run auth0:asetukset -- --aja                 tekee muutokset Auth0:aan
 *   npm run auth0:asetukset -- --vercel              lisäksi Vercelin suunnitelma
 *   npm run auth0:asetukset -- --aja --vercel        muutokset myös Verceliin
 *   ... --korvaa                                     korvaa Vercelin olemassa olevat
 * ===========================================================================
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PORTAL_CONNECTION, STAFF_CONNECTION } from "../src/lib/auth/login-params.ts";
import {
  AUTH0_TUOTANTOMUUTTUJAT,
  MFA_ACTION_NIMI,
  PAKOLLISET_OIKEUDET,
  VALINNAISET_OIKEUDET,
  authModeVoidaanVaihtaa,
  puuttuvatOikeudet,
  tokeninOikeudet,
  ylimaaraisetYhteydet,
  lueYmparistoArvo,
  mfaActionKoodi,
  osoitteetPuuttuvat,
  paivitaYmparisto,
  passwordlessAsetukset,
  sidoksetActionille,
  sovellusOsoitteet,
  tenanttiOnTyhja,
  tietokantayhteydenAsetukset,
  vercelMuuttujat,
  vercelSuunnitelma,
  vieraatSovellukset,
  type Asetukset,
  type Binding,
  type SovellusOsoitteet,
  type TenantClient,
} from "../src/lib/auth/tenant-setup.ts";

/* -------------------------------------------------------------------------
   Asetukset, jotka tähän tenanttiin kuuluvat
   ------------------------------------------------------------------------- */

const SOVELLUS = "eRappu";
const ASETUSSKRIPTI = "Asetusskripti";

/** Osoitteet, joista kirjautuminen saa palata. */
const PERUSTAT = ["http://localhost:3107", "https://www.erappu.fi", "https://erappu.vercel.app"];

/** Tuotannon APP_BASE_URL, jos Vercelissä ei vielä ole arvoa. */
const TUOTANNON_OSOITE = "https://www.erappu.fi";

const LAHETTAJA = "noreply@erappu.fi";
const AIHE = "{{ application.name }}: kirjautumiskoodi";
const POHJA = "auth0/kirjautumiskoodi.liquid";

/** Tenantin nimi näkyy kirjautumissivulla. */
const TENANTIN_NIMI = "eRappu";
const TUKIOSOITE = "https://www.erappu.fi";

const YMPARISTO = ".env.local";

/* -------------------------------------------------------------------------
   Liput ja tulostus
   ------------------------------------------------------------------------- */

const aja = process.argv.includes("--aja");
const pakota = process.argv.includes("--pakota");
const vercel = process.argv.includes("--vercel");
const korvaa = process.argv.includes("--korvaa");
const muutokset: string[] = [];

function kerro(teksti: string): void {
  muutokset.push(teksti);
  console.log(`  ${aja ? "tehty:" : "tehtäisiin:"} ${teksti}`);
}

function jo(teksti: string): void {
  console.log(`  kunnossa: ${teksti}`);
}

function varoita(teksti: string): void {
  console.log(`  HUOM: ${teksti}`);
}

/* -------------------------------------------------------------------------
   Ympäristö
   ------------------------------------------------------------------------- */

function lueTiedosto(): string {
  try {
    return readFileSync(YMPARISTO, "utf8");
  } catch {
    return "";
  }
}

/** Ympäristömuuttuja voittaa tiedoston, kuten Nextissä. */
function vaadi(nimi: string): string {
  const arvo = process.env[nimi]?.trim() || lueYmparistoArvo(lueTiedosto(), nimi);
  if (!arvo) throw new Error(`${nimi} puuttuu. Katso auth0/AJO-OHJE.md, se kertoo mistä arvo otetaan.`);
  return arvo;
}

/** Muut rivit säilyvät (paivitaYmparisto). Arvoja ei tulosteta. */
function kirjoitaYmparisto(arvot: Record<string, string>): void {
  writeFileSync(YMPARISTO, paivitaYmparisto(lueTiedosto(), arvot), "utf8");
}

/* -------------------------------------------------------------------------
   Management API
   ------------------------------------------------------------------------- */

let token = "";
let domain = "";

async function kutsu<T>(metodi: "GET" | "POST" | "PATCH" | "PUT", polku: string, runko?: unknown): Promise<T> {
  let vastaus: Response;
  // Ilmaistason rajoitus (429 "Global limit"): odotetaan ja yritetään uudelleen.
  for (let yritys = 1; ; yritys++) {
    vastaus = await fetch(`https://${domain}/api/v2${polku}`, {
      method: metodi,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: runko === undefined ? undefined : JSON.stringify(runko),
    });
    if (vastaus.status !== 429 || yritys >= 6) break;
    const odota = Math.max(Number(vastaus.headers.get("retry-after") ?? 0) * 1000, 2000 * yritys);
    await vastaus.text();
    await new Promise((r) => setTimeout(r, odota));
  }
  const teksti = await vastaus.text();
  if (!vastaus.ok) {
    // Auth0:n virheviesti sellaisenaan: se kertoo täsmälleen, mikä kenttä tai oikeus puuttuu.
    throw new Error(`${metodi} ${polku} → ${vastaus.status}\n${teksti}`);
  }
  return (teksti ? JSON.parse(teksti) : {}) as T;
}

async function haeToken(): Promise<void> {
  const vastaus = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: vaadi("AUTH0_MGMT_CLIENT_ID"),
      client_secret: vaadi("AUTH0_MGMT_CLIENT_SECRET"),
      audience: `https://${domain}/api/v2/`,
    }),
  });
  if (!vastaus.ok) {
    throw new Error(
      `Management API -tunnistautuminen epäonnistui (${vastaus.status}).\n${await vastaus.text()}\n\n` +
        "Tarkista, että Asetusskripti-sovellukselle on annettu oikeudet Management APIin (auth0/AJO-OHJE.md, kohta 2).",
    );
  }
  token = ((await vastaus.json()) as { access_token: string }).access_token;

  const oikeudet = tokeninOikeudet(token);
  const puuttuvat = puuttuvatOikeudet(oikeudet, PAKOLLISET_OIKEUDET);
  if (puuttuvat.length > 0) {
    throw new Error(
      "PYSÄYTETTY ennen muutoksia: Asetusskripti-sovellukselta puuttuu oikeuksia:\n" +
        puuttuvat.map((o) => `  - ${o}`).join("\n") +
        "\n\nLisää ne: Applications → APIs → Auth0 Management API → Machine To Machine Applications → Asetusskripti.",
    );
  }
  const valinnaiset = puuttuvatOikeudet(oikeudet, VALINNAISET_OIKEUDET);
  if (valinnaiset.length > 0) varoita(`valinnaiset oikeudet puuttuvat (${valinnaiset.join(", ")}); niitä vastaavat kohdat pyydetään tekemään käsin`);
}

/* -------------------------------------------------------------------------
   Vaiheet
   ------------------------------------------------------------------------- */

/** Pysäyttää ajon, jos tenantissa on muiden projektien sovelluksia. */
async function tarkistaTenantti(): Promise<TenantClient[]> {
  const clients = await kutsu<TenantClient[]>("GET", "/clients?fields=client_id,name&include_fields=true&per_page=100");
  const vieraat = vieraatSovellukset(clients, [SOVELLUS, ASETUSSKRIPTI]);

  if (!tenanttiOnTyhja(vieraat)) {
    if (!pakota) {
      throw new Error(
        "PYSÄYTETTY: tenantissa on sovelluksia, jotka eivät kuulu eRapulle:\n" +
          vieraat.map((nimi) => `  - ${nimi}`).join("\n") +
          "\n\nTämä näyttää toisen projektin tenantilta. Jos ajat tämän tässä, noiden sovellusten kirjautuminen muuttuu.\n" +
          "Tarkista AUTH0_MGMT_DOMAIN.\n\nJos tiedät mitä teet, lisää --pakota.",
      );
    }
    varoita(`ohitetaan tenantin tarkistus: ${vieraat.join(", ")}`);
  }
  return clients;
}

async function asetaTenantti(): Promise<void> {
  const nyt = await kutsu<{ friendly_name?: string; support_url?: string; enabled_locales?: string[] }>("GET", "/tenants/settings");
  const kunnossa =
    nyt.friendly_name === TENANTIN_NIMI && nyt.support_url === TUKIOSOITE && JSON.stringify(nyt.enabled_locales ?? []) === JSON.stringify(["fi"]);

  if (kunnossa) return jo(`tenantin nimi ${TENANTIN_NIMI}, tukiosoite ja kieli fi`);

  kerro(`tenantin nimi ${nyt.friendly_name ?? "(tyhjä)"} → ${TENANTIN_NIMI}, tukiosoite ${TUKIOSOITE}, kieli fi`);
  if (aja) await kutsu("PATCH", "/tenants/settings", { friendly_name: TENANTIN_NIMI, support_url: TUKIOSOITE, enabled_locales: ["fi"] });
}

/**
 * Identifier First. Ilman tätä Auth0 pudottaa `connection`-parametrin hiljaa:
 * asukas saisi salasanalomakkeen, vaikka hänellä ei ole salasanaa.
 */
async function asetaTunnistusprofiili(): Promise<void> {
  const nyt = await kutsu<{ identifier_first?: boolean }>("GET", "/prompts");
  if (nyt.identifier_first === true) return jo("Identifier First");

  kerro("Authentication Profile → Identifier First");
  if (aja) await kutsu("PATCH", "/prompts", { identifier_first: true });
}

async function asetaSovellus(clients: TenantClient[]): Promise<string> {
  const osoitteet = sovellusOsoitteet(PERUSTAT);
  const olemassa = clients.find((client) => client.name === SOVELLUS);

  if (olemassa) {
    const nyt = await kutsu<Partial<SovellusOsoitteet>>(
      "GET",
      `/clients/${olemassa.client_id}?fields=callbacks,allowed_logout_urls,web_origins&include_fields=true`,
    );
    if (osoitteetPuuttuvat(nyt, osoitteet)) {
      kerro(`sovellus ${SOVELLUS}: paluu-, uloskirjautumis- ja web origin -osoitteet`);
      if (aja) await kutsu("PATCH", `/clients/${olemassa.client_id}`, osoitteet);
    } else {
      jo(`sovellus ${SOVELLUS} ja sen osoitteet`);
    }
    return olemassa.client_id;
  }

  kerro(`sovellus ${SOVELLUS} luodaan (Regular Web Application)`);
  if (!aja) return "";

  const luotu = await kutsu<{ client_id: string; client_secret: string }>("POST", "/clients", {
    name: SOVELLUS,
    app_type: "regular_web",
    oidc_conformant: true,
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_post",
    ...osoitteet,
  });

  kirjoitaYmparisto({ AUTH0_DOMAIN: domain, AUTH0_CLIENT_ID: luotu.client_id, AUTH0_CLIENT_SECRET: luotu.client_secret });
  kerro(`${YMPARISTO}: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET (arvoja ei tulosteta)`);
  return luotu.client_id;
}

/**
 * `.env.local`: Auth0-arvot paikallista kokeilua ja `--vercel`-vientiä varten.
 * AUTH_MODEa ei kirjoiteta: paikallinen kehitys pysyy kehityskirjautumisessa.
 */
async function taydennaYmparisto(clientId: string): Promise<void> {
  if (!clientId) return;
  const sisalto = lueTiedosto();
  const puuttuu: Record<string, string> = {};

  if (lueYmparistoArvo(sisalto, "AUTH0_DOMAIN") !== domain) puuttuu.AUTH0_DOMAIN = domain;
  if (lueYmparistoArvo(sisalto, "AUTH0_CLIENT_ID") !== clientId) puuttuu.AUTH0_CLIENT_ID = clientId;
  if (!lueYmparistoArvo(sisalto, "AUTH0_SECRET")) puuttuu.AUTH0_SECRET = randomBytes(32).toString("hex");

  const clientIdVaihtui = Boolean(puuttuu.AUTH0_CLIENT_ID) && Boolean(lueYmparistoArvo(sisalto, "AUTH0_CLIENT_ID"));
  if (!lueYmparistoArvo(sisalto, "AUTH0_CLIENT_SECRET") || clientIdVaihtui) {
    // Vaatii oikeuden read:client_keys. Ilman sitä ohjeistetaan kopioimaan käsin.
    const haettu = await kutsu<{ client_secret?: string }>("GET", `/clients/${clientId}?fields=client_secret&include_fields=true`).catch(() => null);
    if (haettu?.client_secret) puuttuu.AUTH0_CLIENT_SECRET = haettu.client_secret;
    else varoita(`AUTH0_CLIENT_SECRET puuttuu ${YMPARISTO}:sta. Kopioi se: Applications → ${SOVELLUS} → Settings → Client Secret.`);
  }

  if (Object.keys(puuttuu).length === 0) return jo(`${YMPARISTO}: Auth0-arvot`);
  kerro(`${YMPARISTO}: ${Object.keys(puuttuu).join(", ")} (arvoja ei tulosteta)`);
  if (aja) kirjoitaYmparisto(puuttuu);
}

async function asetaSahkopostipalvelin(): Promise<void> {
  const salasana = process.env.RESEND_API_KEY?.trim() || lueYmparistoArvo(lueTiedosto(), "RESEND_API_KEY");
  if (!salasana) {
    varoita("RESEND_API_KEY puuttuu, sähköpostipalvelin jää asettamatta. Kirjautumiskoodit lähtevät Auth0:n testipalvelimelta, jolla on tiukka päiväraja.");
    return;
  }

  const nyt = await kutsu<{ name?: string; default_from_address?: string }>("GET", "/emails/provider").catch(() => null);
  kerro(`sähköpostipalvelin: SMTP (Resend), lähettäjä ${LAHETTAJA}`);
  if (!aja) return;

  await kutsu(nyt?.name ? "PATCH" : "POST", "/emails/provider", {
    name: "smtp",
    enabled: true,
    default_from_address: LAHETTAJA,
    credentials: { smtp_host: "smtp.resend.com", smtp_port: 587, smtp_user: "resend", smtp_pass: salasana },
  });
}

interface Yhteys {
  id: string;
  name: string;
  strategy: string;
  options: Asetukset;
  enabled_clients?: string[];
}

/**
 * Yhteyden ja sovelluksen kytkentä. Auth0 siirsi tämän omaan päätepisteeseensä;
 * vanhaan `enabled_clients`-kenttään palataan vain, jos uutta ei ole.
 */
async function haeYhteydenAsiakkaat(yhteys: Yhteys): Promise<Set<string>> {
  try {
    const vastaus = await kutsu<{ clients?: Array<{ client_id: string }> } | Array<{ client_id: string }>>("GET", `/connections/${yhteys.id}/clients`);
    const lista = Array.isArray(vastaus) ? vastaus : (vastaus.clients ?? []);
    return new Set(lista.map((rivi) => rivi.client_id));
  } catch {
    return new Set(yhteys.enabled_clients ?? []);
  }
}

async function kytkeAsiakas(yhteysId: string, clientId: string, paalle = true): Promise<void> {
  try {
    await kutsu("PATCH", `/connections/${yhteysId}/clients`, [{ client_id: clientId, status: paalle }]);
  } catch (virhe) {
    const yhteys = await kutsu<{ enabled_clients?: string[] }>("GET", `/connections/${yhteysId}`);
    const nyt = new Set(yhteys.enabled_clients ?? []);
    if (paalle) nyt.add(clientId);
    else nyt.delete(clientId);
    await kutsu("PATCH", `/connections/${yhteysId}`, { enabled_clients: [...nyt] }).catch(() => {
      throw virhe;
    });
  }
}

async function kytkeSovellukselle(yhteys: Yhteys, clientId: string): Promise<void> {
  if (!clientId) {
    kerro(`${yhteys.name} päälle sovellukselle ${SOVELLUS} (kun sovellus on luotu)`);
    return;
  }
  if ((await haeYhteydenAsiakkaat(yhteys)).has(clientId)) return jo(`${yhteys.name} on päällä sovellukselle ${SOVELLUS}`);
  kerro(`${yhteys.name} päälle sovellukselle ${SOVELLUS}`);
  if (aja) await kytkeAsiakas(yhteys.id, clientId);
}

/** Henkilökunnan tietokantayhteys: salasanapolitiikka, brute force, ei rekisteröitymistä. */
async function asetaTietokantayhteys(clientId: string): Promise<void> {
  const yhteydet = await kutsu<Yhteys[]>("GET", "/connections?strategy=auth0");
  const yhteys = yhteydet.find((y) => y.name === STAFF_CONNECTION);

  if (!yhteys) {
    throw new Error(
      `Tietokantayhteyttä ${STAFF_CONNECTION} ei ole. Kirjautumislinkki (src/lib/auth/login-params.ts) käyttää tätä nimeä.\n` +
        "Luo se: Authentication → Database → Create DB Connection, nimellä " + STAFF_CONNECTION + ".",
    );
  }

  const { options, muutokset: erot } = tietokantayhteydenAsetukset(yhteys.options ?? {});
  if (erot.length === 0) jo(`${STAFF_CONNECTION}: salasanapolitiikka, brute force, rekisteröityminen pois`);
  else {
    kerro(`${STAFF_CONNECTION}: ${erot.join(", ")}`);
    if (aja) await kutsu("PATCH", `/connections/${yhteys.id}`, { options });
  }

  await kytkeSovellukselle(yhteys, clientId);
}

/**
 * Portaalin passwordless-sähköpostiyhteys. Yhteys luodaan käsin ennen ajoa
 * (AJO-OHJE.md, kohta 3), koska skripti kirjoittaa asetukset siihen rakenteeseen,
 * jossa ne tenantissa jo ovat.
 */
async function asetaPasswordless(clientId: string): Promise<void> {
  const yhteydet = await kutsu<Yhteys[]>("GET", "/connections?strategy=email");
  const yhteys = yhteydet.find((y) => y.name === PORTAL_CONNECTION) ?? yhteydet[0];

  if (!yhteys) {
    varoita("Passwordless-sähköpostiyhteyttä ei ole. Kytke se päälle ensin: Authentication → Passwordless → Email (AJO-OHJE.md, kohta 3).");
    return;
  }

  const { options, rakenne, muuttuu } = passwordlessAsetukset(yhteys.options ?? {}, {
    lahettaja: LAHETTAJA,
    aihe: AIHE,
    pohja: readFileSync(POHJA, "utf8"),
  });

  if (!muuttuu) jo("passwordless: lähettäjä, aihe, pohja ja rekisteröityminen sallittu");
  else {
    kerro(`passwordless: lähettäjä ${LAHETTAJA}, aihe, suomenkielinen pohja, rekisteröityminen sallittu (${rakenne})`);
    if (aja) await kutsu("PATCH", `/connections/${yhteys.id}`, { options });
  }

  await kytkeSovellukselle(yhteys, clientId);
}

/**
 * Muut yhteydet (esim. google-oauth2) pois eRapulta. Auth0 voi kytkeä uudelle
 * sovellukselle kaikki tenantin yhteydet; Google-kirjautuminen ohittaisi
 * henkilökunnan MFA-ehdon (strategia ei ole auth0). Yhteyksiä ei poisteta.
 */
async function poistaMuutYhteydet(clientId: string): Promise<void> {
  const yhteydet = await kutsu<Yhteys[]>("GET", "/connections?per_page=100");
  const muut = new Set(ylimaaraisetYhteydet(yhteydet, [STAFF_CONNECTION, PORTAL_CONNECTION]));

  for (const yhteys of yhteydet.filter((y) => muut.has(y.name))) {
    if (!clientId) {
      console.log(`  tarkistetaan sovelluksen luonnin jälkeen: ${yhteys.name} ei saa olla päällä sovellukselle ${SOVELLUS}`);
      continue;
    }
    if (!(await haeYhteydenAsiakkaat(yhteys)).has(clientId)) {
      jo(`${yhteys.name} ei ole päällä sovellukselle ${SOVELLUS}`);
      continue;
    }
    kerro(`${yhteys.name} pois sovellukselta ${SOVELLUS}`);
    if (aja) await kytkeAsiakas(yhteys.id, clientId, false);
  }
}

/** OTP (todennussovellus) päälle. Tenantin MFA-politiikka jää "never"; MFA:n pyytää Action. */
async function asetaOtp(): Promise<void> {
  const tekijat = await kutsu<Array<{ name: string; enabled: boolean }>>("GET", "/guardian/factors");
  if (tekijat.find((t) => t.name === "otp")?.enabled) jo("MFA-tekijä One-time Password");
  else {
    kerro("MFA-tekijä One-time Password päälle");
    if (aja) await kutsu("PUT", "/guardian/factors/otp", { enabled: true });
  }

  const politiikka = await kutsu<string[]>("GET", "/guardian/policies").catch(() => null);
  if (politiikka === null) varoita("tenantin MFA-politiikkaa ei voitu lukea (oikeus read:mfa_policies). Tarkista käsin: Security → Multi-factor Auth → Require Multi-factor Auth = Never.");
  else if (politiikka.length > 0) {
    varoita(
      `tenantin MFA-politiikka on ${politiikka.join(", ")}, ei "never". Se vaatisi MFA:n myös asukkailta. ` +
        "Vaihda käsin: Security → Multi-factor Auth → Require Multi-factor Auth = Never.",
    );
  } else jo('tenantin MFA-politiikka "never" (MFA vain Actionilla)');
}

interface Action {
  id: string;
  name: string;
  code: string;
  status?: string;
  all_changes_deployed?: boolean;
}

async function odotaKaannos(id: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    const action = await kutsu<Action>("GET", `/actions/actions/${id}`);
    if (action.status === "built") return;
    if (action.status === "failed") throw new Error(`Actionin ${MFA_ACTION_NIMI} käännös epäonnistui. Katso Actions → Library.`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Actionin ${MFA_ACTION_NIMI} käännös ei valmistunut 30 sekunnissa. Aja skripti uudelleen.`);
}

/** MFA henkilökunnalle: Action luodaan tai päivitetään, julkaistaan ja sidotaan post-login-flow'hun. */
async function asetaMfaAction(clientId: string): Promise<void> {
  if (!clientId) {
    kerro(`Action "${MFA_ACTION_NIMI}" luodaan, julkaistaan ja sidotaan post-login-flow'hun (kun sovellus on luotu)`);
    return;
  }

  const koodi = mfaActionKoodi(clientId);
  const haku = await kutsu<{ actions?: Action[] }>("GET", `/actions/actions?actionName=${encodeURIComponent(MFA_ACTION_NIMI)}`);
  let action = (haku.actions ?? []).find((a) => a.name === MFA_ACTION_NIMI);

  if (!action) {
    kerro(`Action "${MFA_ACTION_NIMI}" luodaan ja julkaistaan`);
    if (!aja) return kerro("Action sidotaan post-login-flow'hun");
    action = await kutsu<Action>("POST", "/actions/actions", {
      name: MFA_ACTION_NIMI,
      supported_triggers: [{ id: "post-login", version: "v3" }],
      runtime: "node22",
      code: koodi,
    });
    await odotaKaannos(action.id);
    await kutsu("POST", `/actions/actions/${action.id}/deploy`, {});
  } else if (action.code !== koodi || action.all_changes_deployed === false) {
    kerro(`Action "${MFA_ACTION_NIMI}" päivitetään ja julkaistaan`);
    if (aja) {
      if (action.code !== koodi) await kutsu("PATCH", `/actions/actions/${action.id}`, { code: koodi });
      await odotaKaannos(action.id);
      await kutsu("POST", `/actions/actions/${action.id}/deploy`, {});
    }
  } else {
    jo(`Action "${MFA_ACTION_NIMI}" on julkaistu`);
  }

  const { bindings } = await kutsu<{ bindings: Binding[] }>("GET", "/actions/triggers/post-login/bindings");
  const uudet = sidoksetActionille(bindings ?? [], action.id, MFA_ACTION_NIMI);
  if (!uudet) return jo("Action on sidottu post-login-flow'hun");
  kerro("Action sidotaan post-login-flow'hun");
  if (aja) await kutsu("PATCH", "/actions/triggers/post-login/bindings", { bindings: uudet });
}

/* -------------------------------------------------------------------------
   Vercel (--vercel)
   ------------------------------------------------------------------------- */

function vercelKomento(args: string[], syote?: string) {
  // Arvot kulkevat vain stdinin kautta, eivät komentorivillä eivätkä lokissa.
  return spawnSync("npx", ["--yes", "vercel@latest", ...args], { input: syote, encoding: "utf8", shell: true });
}

function vercelVirhe(tulos: ReturnType<typeof vercelKomento>): string {
  return (tulos.stderr ?? "").split("\n").map((r) => r.trim()).filter(Boolean).slice(-2).join(" ");
}

function tuotannonMuuttujat(): Set<string> {
  const tulos = vercelKomento(["env", "ls", "production"]);
  if (tulos.status !== 0) throw new Error(`Vercelin muuttujien luku epäonnistui: ${vercelVirhe(tulos)}\nAja ensin: npx vercel login ja npx vercel link`);
  return vercelMuuttujat(tulos.stdout ?? "");
}

function vercelLisaa(nimi: string, arvo: string, korvataan: boolean): boolean {
  if (korvataan) {
    const poisto = vercelKomento(["env", "rm", nimi, "production", "--yes"]);
    if (poisto.status !== 0) {
      varoita(`${nimi}: poisto epäonnistui, ei muutettu (${vercelVirhe(poisto)})`);
      return false;
    }
  }
  const lisays = vercelKomento(["env", "add", nimi, "production"], arvo);
  if (lisays.status !== 0) {
    varoita(`${nimi}: lisäys epäonnistui (${vercelVirhe(lisays)})${korvataan ? ". Muuttuja on nyt poistettu, aja uudelleen." : ""}`);
    return false;
  }
  return true;
}

/**
 * Auth0-arvot Vercelin tuotantoon ja AUTH_MODE=auth0, kun kaikki on paikallaan.
 * Esikatseluympäristöön ei kosketa: se jatkaa kehityskirjautumisella.
 */
async function vieVerceliin(): Promise<void> {
  if (!existsSync(".vercel/project.json")) {
    throw new Error("Kansiota ei ole kytketty Vercel-projektiin. Aja pääkansiossa: npx vercel link (projekti erappu).");
  }

  const sisalto = lueTiedosto();
  const arvot: Record<string, string | null> = {
    AUTH0_DOMAIN: lueYmparistoArvo(sisalto, "AUTH0_DOMAIN"),
    AUTH0_CLIENT_ID: lueYmparistoArvo(sisalto, "AUTH0_CLIENT_ID"),
    AUTH0_CLIENT_SECRET: lueYmparistoArvo(sisalto, "AUTH0_CLIENT_SECRET"),
    // Tuotannon oma istuntoavain, ei sama kuin paikallinen.
    AUTH0_SECRET: randomBytes(32).toString("hex"),
    APP_BASE_URL: TUOTANNON_OSOITE,
  };

  const olemassa = tuotannonMuuttujat();
  let lisatty = false;

  for (const toimenpide of vercelSuunnitelma(olemassa, AUTH0_TUOTANTOMUUTTUJAT, arvot, korvaa)) {
    if (toimenpide.tyyppi === "ohita") {
      console.log(`  ohitetaan: ${toimenpide.nimi} ${toimenpide.syy}`);
      continue;
    }
    const kuvaus = `Vercel production: ${toimenpide.nimi} ${toimenpide.tyyppi === "korvaa" ? "korvataan" : "lisätään"}`;
    kerro(kuvaus);
    if (aja && vercelLisaa(toimenpide.nimi, arvot[toimenpide.nimi] as string, toimenpide.tyyppi === "korvaa")) lisatty = true;
  }

  // Tarkistus katsoo Vercelin todellisen tilan, ei sitä mitä juuri yritettiin.
  const nyt = aja && lisatty ? tuotannonMuuttujat() : olemassa;
  const { voidaan, puuttuvat } = authModeVoidaanVaihtaa(nyt);

  if (!voidaan) {
    const suunniteltu = !aja && authModeVoidaanVaihtaa(new Set([...nyt, ...AUTH0_TUOTANTOMUUTTUJAT.filter((n) => arvot[n])])).voidaan;
    if (suunniteltu) kerro("Vercel production: AUTH_MODE → auth0 (kun muuttujat on lisätty)");
    else varoita(`AUTH_MODE jää ennalleen, tuotannosta puuttuu: ${puuttuvat.join(", ")}`);
    return;
  }

  kerro("Vercel production: AUTH_MODE → auth0");
  if (aja && vercelLisaa("AUTH_MODE", "auth0", nyt.has("AUTH_MODE"))) {
    console.log("");
    console.log("  Muuttujat luetaan julkaisussa. Julkaise tuotanto uudelleen: npx vercel --prod tai Deployments → Redeploy.");
  }
}

/* -------------------------------------------------------------------------
   Ajo
   ------------------------------------------------------------------------- */

async function ajo(): Promise<void> {
  domain = vaadi("AUTH0_MGMT_DOMAIN");

  console.log("");
  console.log(`Tenantti: ${domain}`);
  console.log(aja ? "Tila: TEHDÄÄN MUUTOKSET" : "Tila: kuivaharjoitus, mitään ei kirjoiteta");
  console.log("");

  await haeToken();
  const clients = await tarkistaTenantti();
  console.log(`Sovelluksia tenantissa: ${clients.length}`);
  console.log("");

  await asetaTenantti();
  await asetaTunnistusprofiili();
  const clientId = await asetaSovellus(clients);
  await taydennaYmparisto(clientId);
  await asetaSahkopostipalvelin();
  await asetaTietokantayhteys(clientId);
  await asetaPasswordless(clientId);
  await poistaMuutYhteydet(clientId);
  await asetaOtp();
  await asetaMfaAction(clientId);

  if (vercel) {
    console.log("");
    console.log("Vercel (production):");
    await vieVerceliin();
  }

  console.log("");
  if (muutokset.length === 0) console.log("Kaikki oli jo kunnossa.");
  else if (aja) {
    console.log(`Valmis: ${muutokset.length} muutosta.`);
    if (!vercel) console.log("Seuraavaksi: kokeile kirjautumista paikallisesti ja aja sitten --aja --vercel (AJO-OHJE.md).");
  } else console.log(`${muutokset.length} muutosta tehtäisiin. Aja uudelleen lipulla --aja.`);
}

try {
  await ajo();
} catch (virhe) {
  console.error("");
  console.error(virhe instanceof Error ? virhe.message : String(virhe));
  console.error("");
  // Ei process.exitiä: se katkaisisi tulostuksen kesken Windowsilla.
  process.exitCode = 1;
}
