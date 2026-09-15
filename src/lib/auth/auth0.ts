import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0-asiakas (eRapun oma tenant `erappu`, EU). Asetukset ympäristömuuttujista:
 * AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL.
 * Tenantin asetukset tekee `npm run auth0:asetukset` (auth0/AJO-OHJE.md).
 *
 * Henkilökunta kirjautuu salasanalla ja MFA:lla, portaalikäyttäjät
 * sähköpostikoodilla. Yhteys valitaan kirjautumislinkin parametrilla
 * (`login-params.ts`), ei tässä, koska sama sovellus palvelee molempia.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: { ui_locales: "fi" },
});

export { PORTAL_LOGIN_PARAMS, STAFF_LOGIN_PARAMS } from "./login-params";
