import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0-asiakas (portfolion jaettu tenant). Asetukset ympäristömuuttujista:
 * AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL.
 *
 * Henkilökunta kirjautuu salasanalla ja MFA:lla, portaalikäyttäjät
 * sähköpostikoodilla. `connection: "email"` vaatii tenantilta Identifier
 * First -profiilin, muuten Auth0 pudottaa parametrin hiljaa (Reilusopparin
 * DECISIONS.md). Portaalin kirjautumislinkki lisää parametrin itse.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: { ui_locales: "fi" },
});

export const PORTAL_LOGIN_PARAMS = new URLSearchParams({ connection: "email", ui_locales: "fi" });
