# eRappu – PLAN

Merkinnät: `[x]` valmis, `[ ]` tekemättä, `[~]` kesken tai odottaa estettä (BLOCKERS.md).

## Perusta (V0)
- [x] Next.js-runko, Tailwind 4, Reilusopparin ulkoasu, StaffShell ja PortalShell
- [x] Kantakerros: PGlite (kehitys, testit) ja Postgres (Supabase), käyttäjäkohtaiset RLS-transaktiot
- [x] Migraatiot 0001 perusta, 0002 rekisteri, 0003 dokumentit ja viestit, 0004 HTJ2-rekisterit
- [x] RLS-testit organisaatioeristykselle ja osakeväleille
- [x] Kehityskirjautuminen ja Auth0-tila, organisaation valinta
- [x] Tietoturva-apurit: kenttäsalaus, HMAC, allekirjoitetut arvot, kertakäyttölinkit
- [x] Tiedostovarasto (local/Supabase) ja lähtevien viestien jono
- [x] Suomalaiset tunnisteet: henkilötunnus, Y-tunnus, viitenumero, RF-viite, IBAN, kiinteistötunnus
- [x] Demodata (kuvitteellinen)
- [x] CI (GitHub Actions: lint, typecheck, test, henkilötunnusvahti) – ajetaan, kun remote on olemassa

## Rekisteri (V1)
- [x] Taloyhtiöt: lista, lisäys, muokkaus, yleissivu
- [x] Huoneistot ja osakevälit tarkistuksineen
- [x] Omistajat ja asukkaat käsin, osakasluettelo
- [x] Hallitus ja toimikaudet
- [x] Kiinteistö ja rakennukset
- [x] Portaalioikeuksien johtaminen rekisteristä
- [x] Access-tuonti 11 asiakasyhtiölle (scripts/access) + laaturaportti (data/private, ei gitiin)
- [x] Haku (yhtiöt, huoneistot, henkilöt)

## M1 Huolto
- [x] Migraatio: huoltopyynnöt, tapahtumat, kuvat (dokumentteina)
- [x] Henkilökunnan työjono: suodattimet, tilat, vastuuhenkilö, tapahtumahistoria
- [x] Palveluntuottajarekisteri ja yhtiökohtaiset palvelut
- [x] Tilaus palveluntuottajalle tehtävälinkillä `/tehtava/[token]` (kuittaus, kommentti, kuva, kustannus)
- [x] Portaali: huoltopyynnön teko ja omat pyynnöt, ilmoittaja voi kuitata tai avata uudelleen
- [x] Julkinen QR-lomake `/ilmoita/[token]`, kutsurajoitin
- [x] Ilmoitukset jonoon tilamuutoksista
- [x] Widgetit ja taloyhtiön huolto-välilehti
- [x] RLS-testit (hallitus näkee yhtiön pyynnöt, asukas vain omansa, palveluntuottaja vain linkin kautta)

## M2 HTJ ja korjaukset
- [x] HTJ-asiakas: rajapinta, mock (kuvitteelliset yhtiöt), mTLS-asiakasrunko MML:n kuvauksen mukaan
- [x] Synkronointi: haku, vertailuraportti rekisteriin, hyväksyntä, omistajanvaihdokset ja portaalioikeudet
- [x] HTJ2-ilmoitusjono: vastikkeet, lainat ja lainaosuudet, KuMu, KPTS (hyväksyntä ennen lähetystä)
- [x] HTJ2-yhteenveto yhtiöittäin käsin ilmoittamista varten (tulostettava) ja ilmoitusvelvollisuuden päättely
- [x] Korjaukset-välilehti: kunnossapito- ja muutostyöhistoria, KPTS 5 vuotta
- [x] Muutostyöilmoitukset: portaalista osakkaalta, käsittely, valmistuminen historiaan
- [x] Widgetit ja testit
- [~] Oikeat MML-polut, JSON-skeemat ja työlajikoodisto `src/lib/htj/mml.ts`:ään ja `src/lib/maintenance/work-types.ts`:ään (`TODO(MML-skeema)`, `TODO(MML-koodisto)`) – BLOCKERS 1

## M3 Talous
- [x] Vastikeperusteet: historia, voimassa oleva peruste, muutos päätöksellä
- [x] Lainat ja lainaosuudet: laskelma osakkeiden suhteessa, kertasuoritus
- [x] Laskutusajo: kuukauden vastikerivit, viitenumerot, hyväksyntä
- [x] Vienti CSV (Procountor-tuontiin sopiva) ja maksutilanteen CSV-tuonti
- [x] Kirjanpitoadapterin rajapinta (PPR myöhemmin)
- [x] Portaali: osakkaan vastikkeet, lainaosuus ja maksutilanne; hallituksen talousnäkymä
- [x] Widgetit ja testit
- [~] Procountorin tarkka myyntilaskujen tuontipohja CSV-vientiin (TODO(Procountor-tuontipohja) `src/lib/finance/accounting/csv.ts`)
- [ ] Portaalin valikkoon linkki `/portaali/talous` (yhteinen `src/config/nav.ts`; nyt linkki portaalin etusivun nostosta)

## M4 Viestintä ja dokumentit
- [x] Tiedotteet: kohderyhmät (yhtiö, rakennus, rooli), kanavat, julkaisu, lähetysraportti
- [x] Dokumenttipankki: lataus, luokat, näkyvyys, lataus RLS-tarkistuksella
- [x] Portaali: tiedotteet ja dokumentit
- [x] Viestijonon ajastettu lähetys (`/api/cron/viestit`)
- [x] Widgetit ja testit

## M5 Kokoukset ja todistukset
- [x] Kokoukset: asialistapohjat (AOYL 6:10), kokous, asiat, kutsu PDF ja lähetys
- [x] Osakasluettelo ja ääniluettelo PDF (äänileikkuri)
- [x] Pöytäkirja PDF ja eSinetti-kierros, webhook, sinetöidyn PDF:n tallennus
- [x] eSinetti-asiakas (mock ja http), Reilusopparin mallin mukaan
- [x] Isännöitsijäntodistus PDF (VNa 365/2010 -rakenne), todistustilaukset julkisella lomakkeella
- [x] Widgetit ja testit
- [~] Pohjien juridinen hyväksyntä, todistuksen toimitustapa ja hinnasto – BLOCKERS 4 ja 9

## M6 Arki
- [x] Vuosikello: toistuvat tehtävät taloyhtiöittäin (tilinpäätös, yhtiökokous, HTJ-päivitys, vakuutukset)
- [x] Varaukset: kohteet, vakiovuorot, kiintiöt, päällekkäisyyden esto; portaalin varauskalenteri
- [x] Sopimusrekisteri ja irtisanomismuistutukset
- [x] Kulutusseuranta (sähkö, vesi, lämpö) yhtiöittäin (`/kulutus`, linkki vuosikellosta ja sopimuksista)
- [x] Muistutusajo `/api/cron/muistutukset`
- [x] Widgetit ja testit

## M7 Asetukset ja portaali
- [x] Henkilökunnan käyttäjät ja kutsut
- [x] Portaalikutsut osakkaille ja asukkaille, kutsun hyväksyntä `/kutsu/[token]` ja osapuoleen liittäminen
- [x] Portaalin "Oma huoneisto" -sivu
- [x] Organisaation asetukset
- [x] Tapahtumaloki-näkymä
- [x] Testit

## Myöhemmin (vaatii Jukan päätöksen tai ulkoisen sopimuksen)
- [~] Oikea HTJ-rajapinta (MML-sopimus, varmenne) – BLOCKERS 1
- [~] Auth0-sovellus ja Supabase-projekti tuotantoon – BLOCKERS 2
- [~] eSinetti-tenant ja API-avain – BLOCKERS 3
- [~] Kokouskutsun, pöytäkirjan ja isännöitsijäntodistuksen juridinen tarkistus – BLOCKERS 4
- [~] PPR-integraatio – BLOCKERS 5

## Integraatio 15.9.2026
- [x] Kaikki moduulit M1–M7 yhdistetty päähaaraan
- [x] Yhteiset valikot (henkilökunta, portaali ja puhelimen alapalkki), Vercel-ajastukset
- [x] Tuotantokäännös (next build) ja savutesti 48 sivulle (scripts/smoke-routes.mts)
- [ ] Demodata myös M1–M6-moduuleille (huoltopyynnöt, tiedotteet, kokoukset, varauskohteet)
- [ ] Tuonti tuotantokantaan Postgres-tilassa (scripts/access/import-access.mts käyttää nyt PGliteä)

## Sopimuspohjat ja massaluonti
- [x] Sopimuspohjat koodissa (`src/lib/contract-templates`): kenttämäärittelyt, paikkamerkit, zod-tarkistus, esitäyttö rekisteristä
- [x] Ensimmäinen pohja: Lumityö- ja hiekoitussopimus (Jukan pohja, korjaukset tarkistettavina DECISIONS.md:ssä)
- [x] Yleinen sopimus-PDF (`src/documents/ContractDocument.tsx`) ja pohjan esikatselu `/sopimukset/pohjat`
- [x] Migraatio 0080: erät ja erän rivit, RLS ja testit
- [x] Massaluonti `/sopimukset/erat`: erä, yhtiöt ja yhtiökohtaiset arvot, muodostus (PDF + sopimusrekisteri), lähetys eSinettiin, seuranta
- [x] Webhookin reititys kohteen mukaan (`src/lib/signing/process.ts`): pöytäkirjat ja sopimukset, sinetöity versio korvaa luonnoksen
- [x] Seuraavan kauden erä (voimassaolo +1 vuosi, edustajat rekisteristä uudelleen)
- [x] Työpöydän nosto: allekirjoitusta odottavat sopimukset
