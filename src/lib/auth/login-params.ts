/**
 * Auth0-kirjautumisen yhteydet ja parametrit.
 *
 * Erillään `auth0.ts`:stä, koska se luo SDK-asiakkaan ympäristömuuttujista jo
 * tuonnissa. Nämä vakiot tarvitaan myös kirjautumissivulla, asetusskriptissä
 * (`scripts/auth0-asetukset.mts`) ja testeissä, joissa asiakasta ei ole.
 *
 * Kaksi käyttäjäryhmää, kaksi yhteyttä:
 * - henkilökunta: tietokantayhteys (salasana), MFA vaaditaan Auth0 Actionilla
 * - portaali: passwordless-sähköposti (kertakäyttöinen koodi)
 *
 * Yhteys annetaan aina eksplisiittisesti. Ilman sitä Auth0 valitsee itse, ja
 * portaalikäyttäjä päätyisi salasanalomakkeelle, jolla hänellä ei ole tunnusta.
 * `connection` vaatii tenantilta Identifier First -profiilin, muuten Auth0
 * pudottaa parametrin hiljaa (asetusskripti kytkee sen päälle).
 */

export const STAFF_CONNECTION = "Username-Password-Authentication";
export const PORTAL_CONNECTION = "email";

export type LoginKind = "staff" | "portal";

export const STAFF_LOGIN_PARAMS = new URLSearchParams({ connection: STAFF_CONNECTION, ui_locales: "fi" });
export const PORTAL_LOGIN_PARAMS = new URLSearchParams({ connection: PORTAL_CONNECTION, ui_locales: "fi" });

/**
 * Onko Auth0-istunto henkilökunnan yhteydestä. Tietokantayhteyden tunnisteet
 * alkavat `auth0|`, passwordless-tunnisteet `email|`. MFA vaaditaan vain
 * tietokantayhteydeltä, joten henkilökunnan kutsua ei saa hyväksyä
 * sähköpostikoodilla: se ohittaisi MFA:n.
 */
export function isStaffConnectionSub(sub: string): boolean {
  return sub.startsWith("auth0|");
}

/** SDK:n kirjautumisreitti oikealla yhteydellä. `returnTo` vain sovelluksen sisäinen polku. */
export function auth0LoginHref(kind: LoginKind, returnTo?: string): string {
  const q = new URLSearchParams(kind === "portal" ? PORTAL_LOGIN_PARAMS : STAFF_LOGIN_PARAMS);
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) q.set("returnTo", returnTo);
  return `/auth/login?${q}`;
}
