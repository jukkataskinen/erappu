# eRappu – rakennusohje Claude Codelle

eRappu on Adepta Tilat Oy:n monivuokralainen isännöintijärjestelmä. Ensimmäinen asiakas on Adepta Oy:n isännöinti (11 taloyhtiötä Toivakassa ja Joutsassa), myöhemmin muut pienet isännöintiyritykset. Järjestelmä korvaa Access-tietokannan `taloyhtiöt.accdb`. Toteutussuunnitelma: https://claude.ai/code/artifact/b03507c4-c350-47d1-b40d-9c4052a513a0 ja `docs/suunnitelma.html`.

**Älä kysy käyttäjältä mitään, mikä on tässä päätetty.** Jos joudut tekemään päätöksen, jota tässä ei ole, tee se tämän dokumentin hengessä ja kirjaa se `DECISIONS.md`:ään. Jos et voi edetä puuttuvan tunnuksen, sopimuksen tai Jukan päätöksen takia, kirjaa asia `BLOCKERS.md`:hen ja jatka seuraavaan tehtävään.

---

## 0. Työskentelyprotokolla

1. Lue `CLAUDE.md`, `PLAN.md`, `DECISIONS.md` ja `BLOCKERS.md`.
2. Tee `PLAN.md`:n seuraava tekemätön tehtävä kokonaan: koodi, testit, migraatio ja tarvittava dokumentaatio.
3. Aja `npm run lint && npm run typecheck && npm run test`. Korjaa virheet ennen jatkamista.
4. Merkitse tehtävä tehdyksi `PLAN.md`:ssä ja kirjaa päätökset `DECISIONS.md`:ään (päivä, päätös, perustelu 1–3 riviä).
5. Lopeta: `git add -A && git commit -m "[kuvaus]"` ja `git push`, jos remote on määritetty.

Säännöt:
- **Käyttöliittymä suomeksi, koodi ja tietokanta englanniksi.** Kommentit suomeksi ja ne kertovat *miksi*, eivät *mitä*. Sävy: sinuttelu, rauhallinen, ei huutomerkkejä, ei emojeita.
- **Ammattitermit suomalaisina:** osakeryhmä, osakeluettelo, vastike, lainaosuus, kunnossapitotarveselvitys, isännöitsijäntodistus, muutostyöilmoitus, yhtiökokous.
- **Jokainen uusi taulu:** etuliite `er_`, `organization_id`, RLS päälle, policyt ja eksplisiittiset GRANTit (`authenticated`, `service_role`). Tee lisäksi RLS-testi, joka todistaa ettei toinen organisaatio näe rivejä.
- Ei salaisuuksia koodiin. Uudet ympäristömuuttujat `.env.example`-tiedostoon selityksineen.
- Ulkoiset palvelut (HTJ, eSinetti, sähköposti, PPR) moduulin `index.ts`-rajapinnan takana, ja mock-toteutus on oletus, kun avain puuttuu.

### 0.1 Tietoturvakysymykset jokaiselle tehtävälle (sama kuin eSinetissä)

1. **Kuka saa kutsua tätä?** Organisaatiorajaus RLS:llä. Toisen organisaation id → 404.
2. **Mitä henkilötietoa liikkuu?** Henkilötunnus ei koskaan lokeihin, URL-osoitteisiin, virheviesteihin tai sähköposteihin. Henkilötunnus luetaan vain `er_party_identifiers`-taulusta palvelun roolilla, ja jokainen luku kirjataan `er_audit_log`:iin.
3. **Voiko syötteeseen luottaa?** Kaikki lomake- ja API-syötteet zodilla. Tiedostojen tyyppi tarkistetaan sisällöstä (`src/lib/storage`).
4. **Voiko tätä arvata tai toistaa?** Linkkitokenit `src/lib/security/access-links.ts`:llä (vain tiiviste kantaan, vanheneminen). Webhookit idempotentteja.
5. **Onko tämä salaisuus?** Avaimet ympäristömuuttujissa, kantaan vain salattuna (`encryptField`).
6. **Mitä tapahtuu, kun tämä epäonnistuu?** Muutos ja siihen liittyvä ilmoitus/loki samassa transaktiossa. Virhe ei paljasta rakennetta käyttäjälle.
7. **Näkyykö tämä lokissa?** `audit()` jokaisesta muutoksesta, jolla on merkitystä riidassa tai tietosuojassa.

---

## 1. Lukitut päätökset

| Aihe | Päätös |
|---|---|
| Runko | Next.js 15 App Router, React 19, TypeScript strict, Tailwind 4. Palvelinkomponentit ja server actionit. Ei client-kirjastoja ilman syytä. |
| Ulkoasu | Reilusopparin perusilme: `ink #1b2a41`, `cloud #f3f6fa`, `line #dfe6f0`, `sky #3d8bff` (toiminto), `coral #ff6f59` (vaatii huomiota), `moss #2e9e6b` (valmis), `amber` (odottaa). Plus Jakarta Sans. Komponentit `src/components/ui.tsx`. Henkilökunta työpöytä ensin (`StaffShell`), portaali puhelin ensin (`PortalShell`). |
| Tietokanta | Postgres. Paikallisesti PGlite (`.data/pglite`), tuotannossa oma Supabase-projekti (EU). **Kaikki kutsut SQL:nä `src/lib/db`-kerroksen kautta**: `ctx.run(tx => ...)` ajaa käyttäjän transaktion roolilla `authenticated` ja JWT-väitteellä `sub`, jolloin RLS on todellinen suojaus. `db.asService` vain taustatöihin, linkkien ratkaisuun ja henkilötunnuksiin. |
| Migraatiot | `supabase/migrations/NNNN_nimi.sql`. Paikallisesti ajetaan automaattisesti (`src/lib/db/migrate.ts`), Supabaseen Supabase CLI:llä. `supabase/local/0000_supabase_shim.sql` vain PGlitelle. |
| Kirjautuminen | `AUTH_MODE=auth0`: portfolion jaettu Auth0-tenant (henkilökunta salasana + MFA, portaali passwordless). `AUTH_MODE=dev`: käyttäjän valinta listasta, estetty tuotannossa. `getCurrentUser`, `requireStaff`, `requirePortal` (`src/lib/auth/current-user.ts`). |
| Roolit | Organisaatio: `owner` (pääkäyttäjä), `manager` (isännöitsijä), `accountant` (kirjanpitäjä: talous ja HTJ2-tiedot, ei rekisterin muokkausta, ei henkilötunnuksia), `assistant`. Portaali: `board`, `owner`, `resident`, `provider`; oikeudet johdetaan rekisteristä (`src/lib/registry/portal-access.ts`). |
| HTJ | Osakeluettelot on siirretty HTJ:hin → HTJ on omistustietojen päälähde. `HTJ_MODE=mock` oletuksena. Oikea rajapinta vaatii MML-sopimuksen (Adepta Tilat Oy) ja mTLS-varmenteen. HTJ2-ilmoitukset (vastikkeet, lainat, KuMu, KPTS) ovat myöhässä (määräaika 30.6.2026): järjestelmä tuottaa yhtiökohtaisen yhteenvedon käsin ilmoittamista varten, kunnes rajapinta on käytössä. |
| Allekirjoitukset | eSinetti API (`ESINETTI_MODE=mock` oletuksena). Adepta Oy myy eSinetin Adepta Tilat Oy:lle. eRappu tekee PDF:n itse (@react-pdf/renderer), eSinetti kerää allekirjoitukset ja sinetöi. Asiakas kopioidaan Reilusopparista (`src/lib/esinetti`). |
| Kirjanpito | Procountor 31.12.2027 asti: vain CSV-vienti ja maksutilanteen CSV-tuonti. 1.1.2028 alkaen Adepta PPR API:n kautta. Ei Fennoaa. |
| Sähköposti | `er_outbound_messages`-jono + `dispatchQueued` (`src/lib/messaging`). `EMAIL_MODE=console` oletuksena. |
| Tiedostot | `src/lib/storage` (local / Supabase Storage, yksityinen). Dokumenttirivi `er_documents` ja näkyvyys (`internal`, `board`, `owners`, `residents`, `provider`, `reporter`). Lataus aina reitin kautta, joka tarkistaa rivin RLS:llä. |
| Henkilötunnukset | Accessista EI tuoda. HTJ:n suppea haku oletuksena (syntymäaika). Jos tunnus tarvitaan: `hetu_hmac` + `hetu_encrypted` taulussa `er_party_identifiers`, luku lokiin. |
| Päivämäärät | Kanta `date`/`timestamptz`, näyttö `src/lib/format.ts` (Europe/Helsinki). Rahat `numeric`, näyttö `formatEur`. |

---

## 2. Rakenne ja moduulien omistus

```
src/app/(henkilokunta)/...   henkilökunnan sivut (StaffShell, requireStaff)
src/app/(portaali)/portaali/ portaalin sivut (PortalShell, requirePortal)
src/app/<julkinen>/          kirjautumattomat reitit (tehtävälinkki, lomakkeet)
src/lib/<alue>/              logiikka ja kyselyt
src/widgets/<moduuli>.tsx    moduulin nostot työpöydälle, yhtiösivulle ja portaalin etusivulle
src/config/nav.ts            päävalikko (yhteinen)
src/config/company-tabs.ts   taloyhtiösivun välilehdet (yhteinen)
supabase/migrations/         migraatiot
tests/db/                    RLS- ja kantatestit (tests/helpers/db.ts: freshDb, seedTwoOrgs)
tests/unit/                  puhdas logiikka
scripts/                     db-reset, seed-demo, access-tuonti
```

| Moduuli | Polut | lib | Migraatiot |
|---|---|---|---|
| Perusta ja rekisteri | `/`, `/kirjaudu`, `/tyopoyta`, `/taloyhtiot` (yleiset, huoneistot, osakkaat, hallitus, kiinteisto) | `db`, `auth`, `registry`, `security`, `storage`, `messaging`, `validation`, `format` | 0001–0009 |
| M1 Huolto | `/huoltopyynnot`, `/palveluntuottajat`, `/taloyhtiot/[id]/huolto`, `/portaali/huoltopyynnot`, `/tehtava/[token]`, `/ilmoita/[token]` | `service-requests` | 0010–0019 |
| M2 HTJ ja korjaukset | `/htj`, `/taloyhtiot/[id]/htj`, `/taloyhtiot/[id]/korjaukset`, `/portaali/muutostyot` | `htj`, `maintenance` | 0020–0029 |
| M3 Talous | `/talous`, `/taloyhtiot/[id]/talous`, `/portaali/talous` | `finance` | 0030–0039 |
| M4 Viestintä ja dokumentit | `/tiedotteet`, `/dokumentit`, `/taloyhtiot/[id]/dokumentit`, `/portaali/tiedotteet`, `/portaali/dokumentit`, `/api/dokumentit/[id]` | `announcements`, `documents` | 0040–0049 |
| M5 Kokoukset ja todistukset | `/kokoukset`, `/taloyhtiot/[id]/kokoukset`, `/todistustilaus/[token]`, `/api/esinetti/webhook` | `meetings`, `esinetti`, `certificates`, `src/documents` (PDF) | 0050–0059 |
| M6 Arki | `/vuosikello`, `/varaukset`, `/sopimukset`, `/portaali/varaukset` | `tasks`, `bookings`, `contracts` | 0060–0069 |
| M7 Asetukset ja portaali | `/asetukset`, `/kutsu/[token]`, `/portaali/oma` | `invitations` | 0070–0079 |

Yhteiset tiedostot (`nav.ts`, `company-tabs.ts`, `ui.tsx`, `current-user.ts`, rekisterin migraatiot) muutetaan vain, jos moduuli ei muuten toimi, ja muutos kirjataan commit-viestiin.

---

## 3. Tietomalli (olemassa olevat perustaulut)

- `er_organizations`, `er_users (auth_sub)`, `er_org_members (role)`, `er_invitations`, `er_audit_log`
- `er_housing_companies`, `er_properties`, `er_buildings`
- `er_share_groups` (osakeryhmä = huoneisto/autopaikka/varasto; `share_count` lasketaan väleistä), `er_share_ranges` (päällekkäisyys estetty exclusion constraintilla)
- `er_parties` (`display_name` generoitu), `er_party_identifiers` (vain service_role), `er_ownerships` (murto-osuus), `er_residencies`, `er_board_memberships`
- `er_service_providers`, `er_company_services`, `er_portal_access`
- `er_documents`, `er_outbound_messages`, `er_access_links`
- `er_charge_bases` (vastikeperusteet, `htj_charge_type`), `er_loans`, `er_loan_shares`, `er_maintenance_works` (KuMu), `er_renovation_notices` (muutostyöilmoitukset), `er_maintenance_needs` (KPTS)

RLS-apufunktiot: `er_current_user_id()`, `er_my_org_ids()`, `er_has_org_role(org, roles[])`, `er_portal_company_ids(roles[])`, `er_portal_share_group_ids()`.

Testiapuri: `tests/helpers/db.ts` → `freshDb()`, `seedTwoOrgs(db)` (orgA + manager/accountant, orgB + manager, yksi yhtiö kummassakin).

---

## 4. Lomakkeet ja virheet

Server action → `parseForm(schema, formData, backTo)` (`src/lib/forms.ts`). Virhe ohjataan takaisin `?virhe=`-parametrilla, ja sivu näyttää sen `<FormError>`-komponentilla. Parametriin vain yleinen virheteksti, ei lomakkeen sisältöä. Onnistumisen jälkeen `revalidatePath` ja `redirect`.

---

## 5. Domain-säännöt

- **Osakevälit** tarkistetaan `checkCoverage`-funktiolla (`src/lib/registry/share-ranges.ts`): päällekkäisyys, aukot, puuttuvat välit, kokonaismäärä.
- **Viitenumero** `referenceNumber(base)` 7-3-1 ja `rfReference`. Taloyhtiön vastikeviite: yhtiön numero + osakeryhmän järjestysnumero, jolloin viite ei muutu omistajan vaihtuessa.
- **Hoitovastike** Adeptan yhtiöissä on €/m²/kk (`basis = 'area_m2'`).
- **HTJ2-ilmoitusvelvollisuus:** pakollinen, jos yhtiössä on yli 5 huoneistoa tai jaettava yhtiölaina; muuten vapaaehtoinen. Tiedot päivitetään yhtiökokouksen jälkeen ja vähintään kerran vuodessa.
- **Muutostyöt** asunto-osakeyhtiölain 5. luvun mukaan: ilmoitus → käsittely (lisätietoja / hyväksytty / hyväksytty ehdoin / kielletty) → valmis → kunnossapito- ja muutostyöhistoriaan → HTJ.
- **Yhtiökokous:** varsinaisen yhtiökokouksen asiat AOYL 6:10 §, kutsu yhtiöjärjestyksen määräajassa, äänileikkuri AOYL 6:27 §. Kokouskutsun ja asialistan juridinen sisältö Jukan hyväksyttävä ennen käyttöä (BLOCKERS).
- **Isännöitsijäntodistus:** AOYL 7:27 § ja VNa 365/2010. Merkintä HTJ:hin kuulumisesta. Omistajat ja rajoitukset HTJ:stä, yhtiön tiedot eRapusta. Pohjan juridinen sisältö Jukan hyväksyttävä.
