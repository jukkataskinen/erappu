/**
 * Auth0-tenantin asetusskriptin turvalogiikka ja arvojen rakentaminen.
 *
 * ===========================================================================
 * MIKSI TÄMÄ ON ERILLÄÄN SKRIPTISTÄ
 *
 * Skripti (`scripts/auth0-asetukset.mts`) puhuu Auth0:aan ja Verceliin eikä
 * sitä voi ajaa testissä. Nämä funktiot ovat puhtaita, joten juuri se osa,
 * joka estää vahingon tai tuottaa hiljaa väärän asetuksen, on testattavissa
 * (`tests/unit/tenant-setup.test.ts`). Pohja on Reilusopparin samanniminen
 * apuri, sovitettuna eRapun kahteen käyttäjäryhmään.
 *
 * VAARA, JOTA VASTAAN TÄMÄ ON KIRJOITETTU
 *
 * Sama Management API -kutsu, joka asettaa uuden tenantin oikein, rikkoo
 * toisen: se vaihtaisi kirjautumissivun nimen, kytkisi yhteyksiä ja lisäisi
 * MFA-säännön muiden sovellusten kirjautumiseen. Ero tenanttien välillä on yksi
 * ympäristömuuttujan rivi, ja väärä rivi ei näytä väärältä. Siksi skripti
 * kieltäytyy ajamasta tenanttiin, jossa on muita kuin odotetut sovellukset.
 *
 * Ei `server-only`-merkintää: skripti ajetaan tsx:llä Nextin ulkopuolella.
 * ===========================================================================
 */

/** Sovellus sellaisena kuin Management API sen palauttaa. */
export interface TenantClient {
  client_id: string;
  name: string;
}

/**
 * Auth0:n omat sovellukset, jotka voivat syntyä uuteen tenanttiin
 * automaattisesti. Näiden olemassaolo ei kerro mitään tenantin käytöstä.
 */
const AUTH0_OMAT = [
  "All Applications",
  "Default App",
  "API Explorer Application",
  "Auth0 Management API",
  "Quickstarts API (Test Application)",
];

/**
 * Sovellukset, jotka eivät kuulu tähän tenanttiin.
 *
 * Tyhjä tulos tarkoittaa, että tenantti on tyhjä tai sisältää vain odotetut.
 * Ei-tyhjä tulos on pysäytys: nimet kertovat ajajalle, minkä tenantin hän oli
 * juuri rikkomassa.
 */
export function vieraatSovellukset(clients: TenantClient[], odotetut: string[]): string[] {
  const sallitut = new Set([...AUTH0_OMAT, ...odotetut].map((nimi) => nimi.toLowerCase()));

  return clients
    .map((client) => client.name)
    .filter((nimi) => !sallitut.has(nimi.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "fi"));
}

/** Onko tenantti turvallinen asetettavaksi. Kutsupaikalla päätös, ei laskutoimitus. */
export function tenanttiOnTyhja(vieraat: string[]): boolean {
  return vieraat.length === 0;
}

/* -------------------------------------------------------------------------
   Management API -oikeudet

   Tarkistetaan tokenista ennen ensimmäistä kirjoitusta. Muuten puuttuva oikeus
   paljastuisi vasta kesken ajon, kun osa asetuksista on jo muutettu.
   ------------------------------------------------------------------------- */

export const PAKOLLISET_OIKEUDET = [
  "read:clients", "create:clients", "update:clients",
  "read:connections", "update:connections", "read:connections_options", "update:connections_options",
  "read:tenant_settings", "update:tenant_settings",
  "read:prompts", "update:prompts",
  "read:email_provider", "create:email_provider", "update:email_provider",
  "read:guardian_factors", "update:guardian_factors",
  "read:actions", "create:actions", "update:actions",
] as const;

/** Ilman näitä skripti jatkaa ja pyytää tekemään kohdan käsin. */
export const VALINNAISET_OIKEUDET = ["read:client_keys", "read:mfa_policies"] as const;

/** Tokenin `scope`-väite. Allekirjoitusta ei tarkisteta: Auth0 tekee sen jokaisessa kutsussa. */
export function tokeninOikeudet(accessToken: string): Set<string> {
  try {
    const osa = accessToken.split(".")[1] ?? "";
    const vaite = JSON.parse(Buffer.from(osa, "base64url").toString("utf8")) as { scope?: unknown };
    return new Set(typeof vaite.scope === "string" ? vaite.scope.split(/\s+/).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

export function puuttuvatOikeudet(oikeudet: Set<string>, tarvittavat: readonly string[]): string[] {
  return tarvittavat.filter((o) => !oikeudet.has(o));
}

/* -------------------------------------------------------------------------
   Yhteydet sovellukselle

   Uusi sovellus voi saada tenantin kaikki yhteydet päälle (esim. Googlen
   kirjautumisen, joka tenantissa on oletuksena). eRapun kirjautuminen on
   rakennettu kahdelle yhteydelle; kolmas ohittaisi kutsun ja MFA:n logiikan.
   ------------------------------------------------------------------------- */

export function ylimaaraisetYhteydet(yhteydet: { name: string }[], sallitut: readonly string[]): string[] {
  const sallittu = new Set(sallitut);
  return yhteydet.map((y) => y.name).filter((nimi) => !sallittu.has(nimi));
}

/* -------------------------------------------------------------------------
   Sovelluksen osoitteet

   Auth0 hylkää kirjautumisen, jos paluuosoite ei ole listassa täsmälleen
   oikeassa muodossa. Yksi puuttuva `/auth/callback` tai ylimääräinen
   kauttaviiva lopussa riittää. Siksi ne rakennetaan perusosoitteista.
   ------------------------------------------------------------------------- */

export interface SovellusOsoitteet {
  callbacks: string[];
  allowed_logout_urls: string[];
  web_origins: string[];
}

function siisti(perusta: string): string {
  return perusta.trim().replace(/\/+$/, "");
}

/** `/auth/callback` tulee Auth0:n Next.js-SDK:sta (v4), polkua ei voi valita vapaasti. */
export function sovellusOsoitteet(perustat: string[]): SovellusOsoitteet {
  const puhtaat = [...new Set(perustat.map(siisti))].filter(Boolean);

  return {
    callbacks: puhtaat.map((perusta) => `${perusta}/auth/callback`),
    allowed_logout_urls: puhtaat,
    web_origins: puhtaat,
  };
}

/** Puuttuuko sovellukselta jokin osoite. Järjestys ei merkitse. */
export function osoitteetPuuttuvat(nyt: Partial<SovellusOsoitteet>, halutut: SovellusOsoitteet): boolean {
  const kentat: (keyof SovellusOsoitteet)[] = ["callbacks", "allowed_logout_urls", "web_origins"];
  return kentat.some((kentta) => {
    const olemassa = new Set(nyt[kentta] ?? []);
    return halutut[kentta].some((osoite) => !olemassa.has(osoite));
  });
}

/* -------------------------------------------------------------------------
   Yhteydet
   ------------------------------------------------------------------------- */

export type Asetukset = Record<string, unknown>;

const SALASANATASOT = ["none", "low", "fair", "good", "excellent"] as const;

/**
 * Henkilökunnan tietokantayhteys: salasanapolitiikka vähintään "good",
 * brute force -suojaus ja rekisteröityminen pois.
 *
 * Rekisteröityminen on pois, koska henkilökunnan tunnus annetaan kutsulla:
 * avoin rekisteröityminen antaisi kenelle tahansa Auth0-tunnuksen eRapun
 * sovellukseen, ja tunnus riittää luomaan er_users-rivin. Jo vahvempaa
 * politiikkaa ("excellent") ei heikennetä.
 *
 * Palauttaa koko options-olion, koska Management API korvaa sen kokonaan.
 */
export function tietokantayhteydenAsetukset(nyt: Asetukset): { options: Asetukset; muutokset: string[] } {
  const options: Asetukset = { ...nyt };
  const muutokset: string[] = [];

  const taso = SALASANATASOT.indexOf(String(nyt.passwordPolicy ?? "none") as (typeof SALASANATASOT)[number]);
  if (taso < SALASANATASOT.indexOf("good")) {
    options.passwordPolicy = "good";
    muutokset.push(`salasanapolitiikka ${String(nyt.passwordPolicy ?? "(ei asetettu)")} → good`);
  }
  if (nyt.brute_force_protection !== true) {
    options.brute_force_protection = true;
    muutokset.push("brute force -suojaus päälle");
  }
  if (nyt.disable_signup !== true) {
    options.disable_signup = true;
    muutokset.push("rekisteröityminen pois");
  }

  return { options, muutokset };
}

export interface PasswordlessPohja {
  lahettaja: string;
  aihe: string;
  pohja: string;
}

/**
 * Passwordless-sähköpostiyhteys: lähettäjä, aihe, pohja ja rekisteröityminen
 * sallittu.
 *
 * Rekisteröityminen on sallittu, koska portaalikäyttäjää ei luoda Auth0:aan
 * etukäteen: kutsu (`/kutsu/[token]`) ohjaa sähköpostikoodiin, ja Auth0-tunnus
 * syntyy ensimmäisellä kirjautumisella. Pelkkä tunnus ei anna oikeuksia —
 * portaalioikeus syntyy vasta, kun vahvistettu sähköposti vastaa kutsua.
 *
 * Auth0 on esittänyt asetukset kahdessa rakenteessa (`options.email.*` ja
 * `options.*`), ja pohjan kenttä on ollut sekä `template` että `body`.
 * Kirjoitetaan siihen muotoon, joka tenantissa jo on; arvaus tuottaisi hiljaa
 * väärän asetuksen.
 */
export function passwordlessAsetukset(nyt: Asetukset, arvot: PasswordlessPohja): { options: Asetukset; rakenne: "options.email" | "options"; muuttuu: boolean } {
  const options: Asetukset = { ...nyt };
  const sisakkainen = Boolean(options.email) && typeof options.email === "object";
  const kohde: Asetukset = sisakkainen ? { ...(options.email as Asetukset) } : options;

  kohde.syntax = "liquid";
  kohde.from = arvot.lahettaja;
  kohde.subject = arvot.aihe;
  if ("template" in kohde) kohde.template = arvot.pohja;
  else kohde.body = arvot.pohja;

  if (sisakkainen) options.email = kohde;
  options.disable_signup = false;

  return {
    options,
    rakenne: sisakkainen ? "options.email" : "options",
    muuttuu: JSON.stringify(options) !== JSON.stringify(nyt),
  };
}

/* -------------------------------------------------------------------------
   MFA henkilökunnalle (Auth0 Action, post-login)

   Tenantin MFA-politiikka jää "never": se koskisi myös passwordless-
   kirjautumista, ja asukkaalta ei vaadita todennussovellusta. Action vaatii
   MFA:n vain, kun kirjautuminen tulee tietokantayhteydestä eRapun sovellukseen.
   ------------------------------------------------------------------------- */

export const MFA_ACTION_NIMI = "eRappu: MFA henkilökunnalle";

/**
 * Actionin lähdekoodi. Sovelluksen client_id kirjoitetaan koodiin, koska nimi
 * voi vaihtua hallintapaneelissa ja tunniste ei.
 *
 * Refresh token -vaihdossa MFA:ta ei voi pyytää (ei käyttäjää ruudulla), ja
 * yritys kaataisi istunnon uusinnan. MFA on tehty jo kirjautuessa.
 */
export function mfaActionKoodi(clientId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(clientId)) throw new Error("client_id on väärän muotoinen");
  return `/**
 * eRappu: MFA henkilökunnalle.
 *
 * ÄLÄ MUOKKAA HALLINTAPANEELISSA. Tämän kirjoittaa eRapun asetusskripti
 * (scripts/auth0-asetukset.mts), ja seuraava ajo korvaa käsin tehdyn muutoksen.
 *
 * Henkilökunta (tietokantayhteys, strategy "auth0") vahvistaa kirjautumisen
 * todennussovelluksella. Portaalin sähköpostikoodikirjautumiseen ei koske.
 */
const ERAPPU_CLIENT_ID = "${clientId}";

exports.onExecutePostLogin = async (event, api) => {
  if (event.client?.client_id !== ERAPPU_CLIENT_ID) return;
  if (event.connection?.strategy !== "auth0") return;
  if (event.transaction?.protocol === "oauth2-refresh-token") return;
  api.multifactor.enable("any", { allowRememberBrowser: false });
};
`;
}

export interface Binding {
  id?: string;
  display_name?: string;
  action: { id: string; name?: string };
}

export interface BindingRef {
  ref: { type: "action_id"; value: string };
  display_name: string;
}

/**
 * Post-login-flow'n uudet sidokset. PATCH korvaa koko listan, joten olemassa
 * olevat sidokset pidetään järjestyksessään ja Action lisätään loppuun.
 * `null` = Action on jo sidottu.
 */
export function sidoksetActionille(nykyiset: Binding[], actionId: string, nimi: string): BindingRef[] | null {
  if (nykyiset.some((b) => b.action.id === actionId)) return null;
  return [
    ...nykyiset.map((b) => ({ ref: { type: "action_id" as const, value: b.action.id }, display_name: b.display_name ?? b.action.name ?? b.action.id })),
    { ref: { type: "action_id", value: actionId }, display_name: nimi },
  ];
}

/* -------------------------------------------------------------------------
   Ympäristömuuttujat
   ------------------------------------------------------------------------- */

/**
 * Kirjoittaa arvot `.env.local`-sisältöön olemassa olevat rivit korvaten.
 *
 * Muut rivit säilyvät koskemattomina järjestyksineen ja kommentteineen.
 * Skripti ajetaan pääkansiossa, jonka `.env.local` voi sisältää esimerkiksi
 * Vercelin OIDC-tunnisteen; sen menettäminen siksi, että Auth0 asetettiin,
 * olisi uusi vahinko.
 */
export function paivitaYmparisto(sisalto: string, arvot: Record<string, string>): string {
  let tulos = sisalto;
  const puuttuvat: string[] = [];

  for (const [avain, arvo] of Object.entries(arvot)) {
    if (!/^[A-Z0-9_]+$/.test(avain)) throw new Error(`Virheellinen muuttujan nimi: ${avain}`);
    // Rivin alussa oleva avain, myös kommentoituna (`# AUTH0_DOMAIN=`). Ei \s,
    // koska se ylittäisi rivinvaihdon ja söisi tyhjän rivin.
    const rivi = new RegExp(`^#?[ \\t]*${avain}=.*$`, "m");
    if (rivi.test(tulos)) {
      // Funktio eikä merkkijono: arvon `$&` tai `$1` ei saa tulkita korvauskaavaksi.
      tulos = tulos.replace(rivi, () => `${avain}=${arvo}`);
    } else {
      puuttuvat.push(`${avain}=${arvo}`);
    }
  }

  if (puuttuvat.length > 0) {
    const erotin = tulos === "" ? "" : tulos.endsWith("\n") ? "\n" : "\n\n";
    tulos += `${erotin}# Auth0 (kirjoitettu skriptillä auth0-asetukset)\n${puuttuvat.join("\n")}\n`;
  }

  return tulos;
}

/** Arvo `.env`-muotoisesta sisällöstä, tai null. Kommentoitu rivi ei kelpaa. */
export function lueYmparistoArvo(sisalto: string, avain: string): string | null {
  for (const rivi of sisalto.split(/\r?\n/)) {
    const kohta = rivi.indexOf("=");
    if (kohta === -1 || rivi.trimStart().startsWith("#")) continue;
    if (rivi.slice(0, kohta).trim() !== avain) continue;
    const arvo = rivi.slice(kohta + 1).trim().replace(/^["']|["']$/g, "");
    return arvo || null;
  }
  return null;
}

/* -------------------------------------------------------------------------
   Vercel (tuotanto)
   ------------------------------------------------------------------------- */

/** Muuttujat, joiden on oltava tuotannossa ennen kuin AUTH_MODE vaihdetaan. */
export const AUTH0_TUOTANTOMUUTTUJAT = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"] as const;

/** Muuttujien nimet `vercel env ls` -tulosteesta. */
export function vercelMuuttujat(tuloste: string): Set<string> {
  return new Set([...tuloste.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s+/gm)].map((m) => m[1]));
}

export type VercelToimenpide =
  | { tyyppi: "lisaa"; nimi: string }
  | { tyyppi: "korvaa"; nimi: string }
  | { tyyppi: "ohita"; nimi: string; syy: string };

/**
 * Mitä tuotannon muuttujille tehdään. Olemassa olevaa ei korvata ilman
 * `--korvaa`-lippua: väärä arvo tuotannossa katkaisee kaikkien kirjautumisen,
 * ja `AUTH0_SECRET`in vaihto kirjaa kaikki ulos.
 *
 * `arvot` sisältää vain ne muuttujat, joille skriptillä on arvo; puuttuva arvo
 * ohitetaan syyn kanssa.
 */
export function vercelSuunnitelma(
  olemassa: Set<string>,
  nimet: readonly string[],
  arvot: Record<string, string | null | undefined>,
  korvaa: boolean,
): VercelToimenpide[] {
  return nimet.map((nimi): VercelToimenpide => {
    const onJo = olemassa.has(nimi);
    if (onJo && !korvaa) return { tyyppi: "ohita", nimi, syy: "on jo olemassa (korvaa lipulla --korvaa)" };
    if (!arvot[nimi]) return { tyyppi: "ohita", nimi, syy: onJo ? "arvoa ei ole, olemassa oleva jätetään" : "arvoa ei ole" };
    return { tyyppi: onJo ? "korvaa" : "lisaa", nimi };
  });
}

/** Saako AUTH_MODE vaihtaa arvoon auth0: kaikki Auth0-muuttujat ovat tuotannossa. */
export function authModeVoidaanVaihtaa(olemassa: Set<string>): { voidaan: boolean; puuttuvat: string[] } {
  const puuttuvat = AUTH0_TUOTANTOMUUTTUJAT.filter((nimi) => !olemassa.has(nimi));
  return { voidaan: puuttuvat.length === 0, puuttuvat };
}
