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
9. **Isännöitsijäntodistuksen toimitus ja hinnasto (M5).** Tilaaja (välittäjä, osakas) ei ole kirjautunut, joten todistusta ei lähetetä liitteenä eikä latauslinkkinä: "Merkitse toimitetuksi" lähettää vain viestin, että todistus toimitetaan erikseen. Päätettävä toimitustapa (esim. kertakäyttöinen, vanheneva latauslinkki eSinetillä sinetöitynä, tai sähköpostin liite) ja verkkomaksu. Hinnat ovat paikkamerkkejä (120 €, pika 180 €, `src/lib/certificates/pricing.ts`). Todistuspohja on luonnos (`CERTIFICATE_TEMPLATE_APPROVED = false`), ja tarkistus-QR osoittaa eSinetin /verify-sivulle vasta, kun todistus sinetöidään.
10. **Isännöitsijäntodistuksen allekirjoitus ja 2027-kohdat.** Todistus sinetöidään eSinetin sähköisellä sinetillä ilman henkilön allekirjoitusta. VNa 365/2010 2 § 5 mom. edellyttää isännöitsijän tai hallituksen puheenjohtajan allekirjoitusta: Jukan vahvistettava, riittääkö sinetti (muuten isännöitsijän allekirjoituskierros). VNa 567/2026 (voimaan 1.1.2027) lisäämille kohdille (4 § 8 a, 8 b ja 16 k., 5 § 3 a ja 6 a k., 6 § 6 k.) ei ole vielä omia kenttiä; ne kirjataan yhtiön tai huoneiston lisätietoihin (DECISIONS 2026-09-15).
