# eRappu – BLOCKERS

Tila 14.9.2026. Kohdat, joita ei voi tehdä ilman Jukan päätöstä, tunnusta tai ulkoista sopimusta. Järjestelmä toimii ilman näitä jäljitelmillä (mock).

1. **HTJ-rajapinta (Maanmittauslaitos).** Testiympäristöhakemus Adepta Tilat Oy:n nimissä: verkkopalvelut@maanmittauslaitos.fi. Tarvitaan testivarmenne, JSON-skeemat, tietoturvaliite, vakiosopimus ja tuotantovarmenne. Samalla: onko KOY Toivakan Säästövakan osakeluettelo siirretty ja koskeeko HTJ2-ilmoitusvelvollisuus sitä.
2. **Tuotantoympäristö.** Oma Supabase-projekti (EU) `erappu`, Auth0-sovellus portfolion tenanttiin (henkilökunta: salasana+MFA, portaali: passwordless, Identifier First), Vercel-projekti, verkkotunnus. Päätettävä, minkä yhtiön nimissä tilit ovat (Adepta Tilat Oy).
3. **eSinetti-tenant.** Tenant `erappu` (tai Adepta Tilat Oy), API-avain ja webhook-salaisuus. eSinettiin tarvitaan: `Idempotency-Key`, kierroskohtainen webhook tai partner-avain, isännöinnin roolit ja pohjat.
4. **Juridiset pohjat.** Kokouskutsun, asialistan, pöytäkirjan ja isännöitsijäntodistuksen sisältö on luonnos. Jukan hyväksyntä ennen käyttöä.
5. **Adepta PPR -integraatio.** PPR:n organisaatioeristyksen korjaus, järjestelmien välinen API ja taloyhtiökirjanpito ennen 1.1.2028.
6. **Telia Tunnistus.** Saako eSinetin tunnistusta käyttää osakkaiden kirjautumiseen ja muiden isännöintiyritysten käyttöön.
7. **Tekstiviestit, kirjeet ja push.** Palveluntarjoajat valitsematta; kanavat ovat jonossa mutta eivät lähde.
8. **Git-remote.** Repo on paikallinen. Push vaatii GitHub-repon.
