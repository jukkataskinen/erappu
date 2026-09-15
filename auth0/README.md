# Auth0

eRapun oma tenantti `erappu` (EU). Asetukset tehdään skriptillä, ei
hallintapaneelissa, jotta ne ovat versionhallinnassa ja toistettavissa.

| | |
|---|---|
| `AJO-OHJE.md` | **Tenantin asetus, Vercel ja ensimmäinen pääkäyttäjä** — aloita tästä |
| `kirjautumiskoodi.liquid` | Passwordless-yhteyden viestipohja (skripti kirjoittaa sen Auth0:aan) |
| `../scripts/auth0-asetukset.mts` | Asettaa tenantin Management API:n kautta, `--vercel` vie arvot tuotantoon |
| `../src/lib/auth/tenant-setup.ts` | Skriptin testattava logiikka, myös MFA-Actionin koodi |
| `../src/lib/auth/login-params.ts` | Yhteyksien nimet ja kirjautumislinkit |
| `../scripts/deploy/bootstrap-owner.mts` | Tuotannon ensimmäinen organisaatio ja pääkäyttäjän kutsu |

## Kaksi käyttäjäryhmää

| | Henkilökunta | Portaali (asukas, osakas, hallitus) |
|---|---|---|
| Yhteys | `Username-Password-Authentication` | Passwordless `email` |
| Kirjautuminen | salasana + todennussovellus | kertakäyttöinen koodi sähköpostiin |
| Auth0-tunnus | luodaan käsin ennen kutsua (rekisteröityminen pois) | syntyy ensimmäisellä kirjautumisella |
| Oikeudet | kutsu → `er_org_members` | kutsu → `er_parties.user_id` → rekisteri |

MFA on Actionissa eikä tenantin politiikassa, koska politiikka koskisi myös
sähköpostikoodikirjautumista.

## Muistettavaa

- **Passwordless-viestin pohja on yhteyden asetuksissa, ei Branding → Email
  Templates -listassa.** Se lista hoitaa salasanan vaihdon, MFA:n ja
  sähköpostin vahvistuksen.
- **From on kahdessa paikassa, ja yhteyden kenttä voittaa.** Email Provider
  -sivun lähettäjä on vain oletus; passwordless-yhteyden oma oletus
  `root@auth0.com` ohittaa sen, ja Resend hylkää vieraan domainin. Skripti
  asettaa molemmat.
- **Auth0 ohittaa muokatut pohjat, kunnes oma sähköpostipalvelin on
  asetettu.** Siksi `RESEND_API_KEY` kannattaa olla paikallaan ensimmäisellä
  ajolla.
- Pohjaa ei voi testata paneelista. Ainoa tapa nähdä se on pyytää
  kirjautumiskoodi sovelluksesta.
