/**
 * eSinetti-yhteystesti: API-avain, osoite ja webhook-salaisuus.
 *
 *   ESINETTI_API_URL=https://app.esinetti.fi/api/v1 \
 *   ESINETTI_API_KEY=<avain> \
 *   npm run esinetti:yhteystesti
 *
 * Kutsuu vain lukevaa reittiä (`/usage`), joten mitään ei synny eikä muutu
 * eSinetin puolella. Tulostaa HTTP-tilan ja sen merkityksen, ei avainta
 * eikä vastauksen sisältöä kiintiölukuja lukuun ottamatta.
 *
 * Kutsun jälkeen paluuarvo asetetaan `process.exitCode`:lla eikä
 * `process.exit()`:llä: Windowsilla pakotettu lopetus kesken HTTPS-yhteyden
 * sulkemisen kaataa Noden libuv-assertioon (UV_HANDLE_CLOSING).
 */

const apiUrl = (process.env.ESINETTI_API_URL?.trim() || "https://app.esinetti.fi/api/v1").replace(/\/+$/, "");
const apiKey = process.env.ESINETTI_API_KEY?.trim() ?? "";
const webhookSecret = process.env.ESINETTI_WEBHOOK_SECRET?.trim() ?? "";

// Ennen kutsua ei ole avoimia yhteyksiä, joten tässä `process.exit` on turvallinen.
if (!apiKey || !/^sk_(live|test)_[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
  console.error(
    apiKey
      ? "ESINETTI_API_KEY ei ole oikean muotoinen (sk_live_… tai sk_test_…). Kopioi avain eSinetin /api-keys-sivulta."
      : "ESINETTI_API_KEY puuttuu. Luo avain eSinetin /api-keys-sivulta ja aja komento uudelleen.",
  );
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);

try {
  const response = await fetch(`${apiUrl}/usage`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    signal: controller.signal,
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const meaning =
    response.status === 200
      ? "OK: avain kelpaa ja osoite on oikein."
      : response.status === 401 || response.status === 403
        ? "Avain ei kelpaa tai se on peruttu. Luo uusi avain eSinetissä."
        : response.status === 404
          ? "Osoite on väärä. Tarkista ESINETTI_API_URL (oikea muoto: https://app.esinetti.fi/api/v1)."
          : response.status === 429
            ? "Kutsuraja tuli vastaan. Odota hetki ja yritä uudelleen."
            : "Odottamaton vastaus.";
  const quota =
    response.ok && body && typeof body === "object"
      ? Object.entries(body as Record<string, unknown>)
          .filter(([, v]) => typeof v === "number" || typeof v === "string")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "";
  console.log(`HTTP ${response.status}\n${meaning}${quota ? `\nKiintiö: ${quota}` : ""}`);
  console.log(webhookSecret ? "ESINETTI_WEBHOOK_SECRET on asetettu." : "ESINETTI_WEBHOOK_SECRET puuttuu: valmiit allekirjoitukset eivät päivity eRappuun.");
  if (!response.ok) process.exitCode = 1;
} catch (err) {
  const aborted = err instanceof Error && err.name === "AbortError";
  console.error(aborted ? "Aikakatkaisu: eSinettiin ei saatu yhteyttä." : "Yhteysvirhe: eSinettiin ei saatu yhteyttä.");
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
