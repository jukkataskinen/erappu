# eRappu omaan Auth0-tenanttiin

Tämä on ajo-ohje, ei taustapaperi. Perustelut ovat `DECISIONS.md`:ssä.

**Lopputulos:** eRapulla on oma EU-alueen tenantti `erappu`. Henkilökunta
kirjautuu salasanalla ja todennussovelluksella (MFA), asukkaat, osakkaat ja
hallitus sähköpostikoodilla. Tuotanto (`https://www.erappu.fi`) siirtyy
kehityskirjautumisesta Auth0:aan, ja ensimmäinen pääkäyttäjä syntyy kutsulla.

**Kaikki komennot ajetaan eRapun pääkansiossa** (`PROJECTS\erappu`), jossa on
`.env.local` ja Vercel-kytkentä (`.vercel`).

---

## 1. Tili ja tenantti: tehty

Tenantti `erappu` on luotu EU-alueelle. Tarkista vielä Tenant Settings →
General: pitää lukea `erappu` ja `EU-...`, osoiterivillä `/dashboard/eu/erappu/`.

Kolme ansaa, joihin Reilusopparin siirrossa kompastuttiin, jos tenantti joskus
luodaan uudelleen:

1. **Rekisteröityminen luo tenantin itse** nimellä `dev-...` ja alueella US.
   Kumpaakaan ei voi muuttaa jälkikäteen.
2. **Ilmaistasolla on yksi tenantti per tili:** poista ensin vanha
   (Settings → Advanced → alalaita), luo sitten uusi.
3. **Create tenant -dialogin nimikenttä on ylimpänä, ruudun ulkopuolella.**
   Vieritä dialogia ylöspäin, muuten nimeksi tulee taas `dev-...`.

---

## 2. Asetusskriptin tunnukset

Applications → **Create Application**:

| Kenttä | Arvo |
|---|---|
| Name | `Asetusskripti` (tarkka nimi: skripti tunnistaa sen) |
| Type | **Machine to Machine** |
| API | **Auth0 Management API** |

Oikeuksiksi (scopes) nämä, ei muita:

```
read:clients              create:clients          update:clients
read:client_keys
read:connections          update:connections
read:connections_options  update:connections_options
read:tenant_settings      update:tenant_settings
read:prompts              update:prompts
read:email_provider       create:email_provider   update:email_provider
read:guardian_factors     update:guardian_factors
read:mfa_policies
read:actions              create:actions          update:actions
```

- Skripti tarkistaa oikeudet tokenista **ennen ensimmäistä muutosta** ja
  pysähtyy listaan puuttuvista.
- `update:connections_options` on erillinen oikeus, eikä `update:connections`
  riitä sen tilalle.
- Actionin julkaisu ja Login-flow'n sidokset käyttävät Auth0:n dokumentaation
  mukaan `actions`-oikeuksia; erillistä deploy- tai triggers-oikeutta ei
  tarvita. Jos Auth0 silti vastaa *"Insufficient scope"*, virheviesti nimeää
  puuttuvan oikeuden: lisää se ja aja uudelleen (aiemmat vaiheet ohitetaan).
- Valinnaiset: `read:client_keys` (vain jos sovellus `eRappu` on jo olemassa ja
  sen Client Secret puuttuu `.env.local`:ista) ja `read:mfa_policies` (tenantin
  MFA-politiikan tarkistus). Ilman niitä skripti pyytää tekemään kohdan käsin.
- Älä valitse "Select All": se antaisi oikeuden poistaa käyttäjiä.

Kopioi **Settings**-välilehdeltä pääkansion `.env.local`:iin:

```
AUTH0_MGMT_DOMAIN=erappu.eu.auth0.com
AUTH0_MGMT_CLIENT_ID=...
AUTH0_MGMT_CLIENT_SECRET=...
```

Lisää rivit tiedoston loppuun. Älä poista olemassa olevia rivejä
(`VERCEL_OIDC_TOKEN`). `.env.local` on gitignoressa.

---

## 3. Passwordless-yhteys päälle

**Authentication → Passwordless → Email** → kytke päälle. Asetuksia ei tarvitse
säätää: skripti kirjoittaa lähettäjän, otsikon ja pohjan
(`auth0/kirjautumiskoodi.liquid`) siihen rakenteeseen, jossa Auth0 ne esittää.

Tietokantayhteys `Username-Password-Authentication` on uudessa tenantissa
valmiina. **Älä poista sitä:** henkilökunta kirjautuu sen kautta.

---

## 4. Sähköposti (Resend)

Resendissä pitää olla vahvistettu domain `erappu.fi` (SPF, DKIM, mieluiten
DMARC), koska kirjautumiskoodit lähtevät osoitteesta `noreply@erappu.fi`.
Lisää avain `.env.local`:iin:

```
RESEND_API_KEY=re_...
```

Skripti asettaa sen Auth0:n SMTP-salasanaksi eikä tulosta sitä. Ilman avainta
skripti varoittaa ja jatkaa, mutta koodit lähtevät Auth0:n testipalvelimelta,
jolla on tiukka päiväraja.

---

## 5. Kuivaharjoitus

```
npm run auth0:asetukset
```

Mitään ei kirjoiteta. **Lue ensimmäinen rivi:** siinä lukee tenantti. Jos
tenantissa on muita kuin `eRappu`, `Asetusskripti` ja Auth0:n omat sovellukset,
skripti pysähtyy ja näyttää nimet. Silloin `AUTH0_MGMT_DOMAIN` osoittaa väärään
tenanttiin. Korjaa se äläkä käytä `--pakota`.

---

## 6. Ajo

```
npm run auth0:asetukset -- --aja
```

Skripti tekee nämä, ja jokainen vaihe ohitetaan, jos se on jo kunnossa
(uudelleenajo on turvallinen):

1. Tenantin nimi `eRappu`, tukiosoite `https://www.erappu.fi`, kieli suomi
2. Authentication Profile → **Identifier First**
3. Sovellus `eRappu` (Regular Web Application), paluu-, uloskirjautumis- ja
   web origin -osoitteet: `http://localhost:3107`, `https://www.erappu.fi`,
   `https://erappu.vercel.app`
4. `.env.local`: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` ja
   paikallinen `AUTH0_SECRET` (arvoja ei tulosteta, muut rivit säilyvät,
   `AUTH_MODE`a ei kirjoiteta)
5. Sähköpostipalvelin: Resendin SMTP, lähettäjä `noreply@erappu.fi`
6. Tietokantayhteys (henkilökunta): salasanapolitiikka vähintään *good*, brute
   force -suoja, **rekisteröityminen pois**, päälle sovellukselle eRappu
7. Passwordless (portaali): lähettäjä, otsikko, suomenkielinen pohja,
   **rekisteröityminen sallittu**, päälle sovellukselle eRappu
8. Muut yhteydet (tenantissa `google-oauth2`) **pois sovellukselta eRappu**.
   Yhteyksiä ei poisteta tenantista. Google-kirjautuminen ohittaisi
   henkilökunnan MFA-ehdon.
9. MFA-tekijä **One-time Password** päälle; tenantin MFA-politiikka tarkistetaan
   (pitää olla *Never*)
10. Action **eRappu: MFA henkilökunnalle** luodaan, julkaistaan ja sidotaan
   Login-flow'hun. Se vaatii MFA:n vain tietokantayhteyden kirjautumisilta
   eRapun sovellukseen. Älä muokkaa sitä paneelissa: seuraava ajo korvaa.

> Identifier First on se, joka unohtuu käsin tehdessä. Ilman sitä Auth0
> pudottaa kirjautumislinkin `connection`-parametrin **hiljaa**, ja asukas saa
> salasanalomakkeen, vaikka hänellä ei ole salasanaa.

---

## 7. Henkilökunnan Auth0-tunnus

Henkilökunnan rekisteröityminen on pois päältä, joten tunnus luodaan käsin
**ennen kutsua**. Ensimmäisenä omasi:

**User Management → Users → Create User**

| Kenttä | Arvo |
|---|---|
| Email | sama osoite, johon kutsu tulee |
| Password | pitkä satunnainen, sitä ei tarvitse muistaa |
| Connection | `Username-Password-Authentication` |

Kirjaudu sitten henkilökuntana ja valitse **"Unohditko salasanan?"**. Viestin
linkki asettaa oman salasanan ja vahvistaa samalla sähköpostiosoitteen.
**Vahvistus on pakollinen:** kutsu hyväksytään vain vahvistetulla osoitteella.
Tarkista käyttäjän sivulta, että Email näyttää *verified*.

Ensimmäisellä kirjautumisella Auth0 pyytää ottamaan käyttöön
todennussovelluksen (Google Authenticator, Microsoft Authenticator tai vastaava).

Asukkaille ei luoda tunnuksia: tunnus syntyy, kun he kirjautuvat kutsulinkin
kautta sähköpostikoodilla.

Henkilökunnan kutsua ei voi hyväksyä sähköpostikoodilla kirjautuneena, koska
se ohittaisi MFA:n. Sama osoite ei myöskään voi toistaiseksi olla sekä
henkilökunnan että portaalin tunnus (ks. `DECISIONS.md`).

---

## 8. Testaus paikallisesti

Paikallinen kehitys pysyy kehityskirjautumisessa. Auth0:aa kokeillaan
käynnistämällä palvelin tilapäisesti auth0-tilassa (PowerShell):

```
$env:AUTH_MODE="auth0"; $env:APP_BASE_URL="http://localhost:3107"; npm run dev
```

Avaa `http://localhost:3107/kirjaudu`. Sivulla on kaksi painiketta.

- [ ] **Kirjaudu henkilökuntana**: salasana, sitten todennussovelluksen koodi
- [ ] **Kirjaudu portaaliin**: kysyy **sähköpostia, ei salasanaa**
- [ ] Koodi tulee perille, viesti on suomeksi, lähettäjä `noreply@erappu.fi`
- [ ] Outlookissa ei varoituspalkkia

Paikallisessa kannassa sinulla ei ole jäsenyyttä, joten kirjautumisen jälkeen
näkyy "Ei oikeutta". Se riittää todisteeksi, että kirjautuminen toimii.

Jos portaalissa näkyy salasanakenttä, Identifier First ei ole päällä: aja
skripti uudelleen. Sulje lopuksi palvelin ja avaa uusi terminaali, jotta
`AUTH_MODE` ei jää päälle.

---

## 9. Vercel

Kerran: `npx vercel login` ja pääkansiossa `npx vercel link` (projekti `erappu`),
jos niitä ei ole tehty.

```
npm run auth0:asetukset -- --vercel          suunnitelma, ei kirjoita
npm run auth0:asetukset -- --aja --vercel    kirjoittaa
```

Vain **production**-ympäristöön, esikatselu jatkaa kehityskirjautumisella.
Arvot kulkevat Vercelin komennolle stdinin kautta eivätkä näy ruudulla.

| Muuttuja | Arvo |
|---|---|
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | `.env.local`:ista |
| `AUTH0_SECRET` | uusi satunnainen (32 bittiä hex), vain jos puuttuu |
| `APP_BASE_URL` | `https://www.erappu.fi`, vain jos puuttuu |
| `AUTH_MODE` | `dev` → `auth0`, **vain jos kaikki yllä olevat ovat tuotannossa** |

Olemassa olevaa muuttujaa ei korvata, vaan skripti kertoo sen. Korvaus vain
lipulla `--korvaa`. Huomaa, että `AUTH0_SECRET`in korvaus kirjaa kaikki ulos.

`APP_BASE_URL` on mukana, koska SDK kieltäytyy tuotannossa ilman sitä, ja
kutsulinkit muodostetaan siitä.

**Julkaise uudelleen** (`npx vercel --prod` tai Deployments → Redeploy):
muuttujat luetaan julkaisussa.

---

## 10. Ensimmäinen pääkäyttäjä tuotantoon

Tuotannon kannassa on vain migraatiot. Skripti luo organisaation **Adepta Oy**
(2237131-2) ja sille pääkäyttäjän kutsun. Kun avaat kutsulinkin ja kirjaudut,
Auth0-tunnuksesi kytkeytyy käyttäjäriviin ja kutsu antaa pääkäyttäjän roolin.

```
npx vercel env pull .env.production.local --environment production
npx tsx scripts/deploy/bootstrap-owner.mts --email oma.osoite@adepta.fi
npx tsx scripts/deploy/bootstrap-owner.mts --email oma.osoite@adepta.fi --aja
```

- Ensimmäinen rivi hakee tuotannon muuttujat tiedostoon. Tiedosto on
  gitignoressa, ja skripti kieltäytyy, jos ei olisi.
- Kuivaharjoitus ajaa saman transaktion ja peruu sen. Tarkista tulosteesta
  kannan osoite.
- `--aja` tulostaa kutsulinkin. Avaa se, valitse **Kirjaudu hyväksyäksesi**,
  kirjaudu henkilökuntana ja hyväksy kutsu. Linkki on voimassa 14 päivää ja
  henkilökohtainen.
- Jos olet jo ehtinyt kirjautua tuotantoon, skripti lisää pääkäyttäjän roolin
  suoraan käyttäjäriviisi eikä linkkiä tarvita.
- **Poista `.env.production.local` lopuksi.** Siinä on tuotannon salaisuudet.

Jos tiedostossa tietokantaosoite on tyhjä (Vercel ei palauta arkaluonteisiksi
merkittyjä arvoja), kopioi Supabasesta Connect → **Session pooler** -osoite
tiedostoon riville `DATABASE_URL=`.

Muut henkilökunnan jäsenet kutsutaan sen jälkeen sovelluksen asetuksista. Luo heille ensin Auth0-tunnus kohdan 7 mukaan.

---

## 11. Lopuksi

- [ ] Kirjaudu `https://www.erappu.fi`:hin henkilökuntana, MFA kysytään
- [ ] Organisaatio Adepta Oy näkyy, olet pääkäyttäjä
- [ ] Kutsu itsesi tai testiosoite portaaliin ja kirjaudu sähköpostikoodilla
- [ ] Esikatselujulkaisu toimii yhä kehityskirjautumisella
- [ ] `.env.production.local` poistettu

## Jos menee pieleen

Vercelissä `AUTH_MODE` takaisin arvoon `dev` ja uudelleenjulkaisu: tuotanto
palaa tilaan, jossa kirjautumista ei ole (kehityskirjautuminen on tuotannossa
estetty). Tenantissa ei ole mitään menetettävää ennen ensimmäistä oikeaa
käyttäjää, joten skriptin voi ajaa uudelleen niin monta kertaa kuin tarvitaan.
