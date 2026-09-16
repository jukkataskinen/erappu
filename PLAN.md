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
- [x] Tilauksen jako pikaviestimeen (17.9.2026): "Tilaa jakolinkillä" luo tehtävälinkin ilman sähköpostia ja näyttää lyhyen viestin (ei osoitetta eikä asukkaan tietoja), WhatsApp-painike palveluntuottajan numeroon, kopiointi ja puhelimen jakovalikko
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

## Muutostyöt ja portaali (verrokkianalyysi 16.9.2026)
Lähde: Kiinteistö-Tahkolan portaalin näkymät ja 24-sivuinen Muutostyöohje (Jukan toimittamat).
- [x] 1. Muutostyöilmoituksen lomake: monta muutostyötä samaan ilmoitukseen, työnsuorittaja työlajeittain, liitteet, pakollinen kuittaus muutostyöohjeen lukemisesta ja linkki ohjeeseen, ilmoitustapa (sähköposti/tekstiviesti), infolaatikko (käsittelyaika 2-4 vk, ei saa aloittaa ennen hyväksyntää)
  - [x] Migraatio 0093: `er_renovation_notice_works`, vanhat ilmoitukset työriveiksi, dokumenttiluokka `renovation_guide`, kuittaus ja ilmoitustapa ilmoitukselle, liitteiden RLS; RLS- ja yhteensopivuustestit
  - [x] Portaalin lomake (4 työlohkoa, tekijä, liitteet, kuittaus, ilmoitustapa, infolaatikko), lista työrivien määrällä, henkilökunnan käsittelysivu, korjaushistoria työriveittäin ja isännöitsijäntodistus
  - [~] Tekstiviesti-ilmoitus tilamuutoksista: valinta tallennetaan, lähetys odottaa kanavaa – BLOCKERS 7
- [x] 2. Etenemisjana portaaliin: vastaanotettu, hyväksytty, työn alla, valmis - sekä muutostöille että huoltopyynnöille (`src/lib/progress.ts`, `ProgressSteps`; muutostyökortit ja huoltopyynnön sivu)
- [ ] 3. Hyväksyntään valvoja ja valvonnan arvioitu kustannus (osakkaan kustannus; kytkeytyy valvontakone-suunnitelmaan)
- [x] 4. Yhteydenotot: kaksisuuntainen viestiketju osakas - isännöitsijä, liitteet, arkisto (nyt vain yksisuuntaiset tiedotteet ja huoltopyynnöt)
  - [x] Migraatio 0095: `er_contact_threads`, `er_contact_messages`, tila viestistä triggerillä (avoin/vastattu/käsitelty), liitteet dokumentteina (`internal` + oman ketjun lukusääntö), sähköposti-ilmoitus ilman viestin sisältöä; RLS-testit `tests/db/yhteydenotot.test.ts`
  - [x] Portaali `/portaali/yhteydenotot` (lista, uusi, ketju), henkilökunta `/yhteydenotot` (postilaatikko suodattimin, vastaus, käsitelty/avaa), työpöydän nosto ja navigaatio
  - [ ] Henkilökunnan aloittama viesti osakkaalle (nyt ketjun aloittaa aina portaalikäyttäjä)
- [ ] 5. Muutostyöohjeen generaattori yhtiökohtaisesti (kuten pelastussuunnitelma): vastuunjako, ohjeet työlajeittain, valvontahinnasto
- [~] 6. Osakeryhmälle talo-, porras- ja kerroskenttä (DECISIONS 16.9.2026: Torpat säilytti yhdistelmätunnukset, koska talotiedolle ei ole kenttää)
  - [x] Kentät ovat jo olemassa: `er_share_groups.building_id` (huoneistolomake), `floor` ja `staircase` (0091, todistuslomake) – tarkistettu 16.9.2026
  - [ ] Accessista tuotuja yhtiöitä varten puuttuu rakennusrivit: nyt yksi rivi tunnuksella "N rakennusta". Tarvitaan rakennukset (tunnus, valmistumisvuosi) Jukalta, jonka jälkeen huoneistot voi kytkeä taloihin ja Torppien tunnukset jakaa kenttiin
- [x] 7. Interaktiivinen vastuunjakotaulukko: 8 tilaa omina SVG-kuvina, 56 kohdetta klikattavina pisteinä (yhtiö / osakas / jaettu), tulkinnat AOYL 4 luvun pohjalta lakiviitteineen, luettelo kuvan alla. Yhtiökohtaiset poikkeukset (migraatio 0094, RLS- ja sisältötestit), `/taloyhtiot/[id]/vastuunjako` (muokkaus), `/portaali/vastuunjako`, linkki portaalin huoltopyyntölomakkeelta, moduulikortti ja portaalin valikko, demopoikkeus
  - [~] Tulkintojen tarkistus (`RESPONSIBILITY_CONTENT_APPROVED`) – BLOCKERS 12

## Pitkän aikavälin suunta (Jukka 15.9.2026)
- [ ] Palveluntuottajapuolen oma järjestelmä eRapun pariksi (kiinteistöhuolto, sähkö- ja putkiurakoitsijat). Sama rakenne kuin Kasamaster (toimittaja) ja suunnitteilla oleva KuokkaMaster (urakoitsija) omassa tuotantoketjussaan: kummallekin ketjun puolelle oma järjestelmä, ja yhteinen tieto (kohde, huoltopyyntö tai tilaus, toteuma, kuvat, lasku) kulkee molempiin, jotta ristiinmyynti onnistuu. eRappu ja Kasamaster/KuokkaMaster ovat eri ketjuja eivätkä liity toisiinsa. Ei esteellisyys- tai ohjausmekanismeja. Huomioitavat ennen suunnittelua:
  - Tietomalli: palveluntuottaja omana organisaationaan (nyt er_service_providers on isännöintiorganisaation alla). Yhteinen tieto (kohde, tilaus, työ, kuvat) jaetaan kahden organisaation kesken, omat myyntitiedot (asiakkuudet, tarjoukset, hinnastot) pysyvät kummankin omina.
  - Suostumukset: sähköinen suoramarkkinointi kuluttajille (osakkaat, asukkaat) vaatii ennakkosuostumuksen; taloyhtiön rekisteritietoja ei voi käyttää markkinointiin ilman käyttötarkoituksen mukaista perustetta (GDPR 6 ja 21 art.).
- [ ] Huoltopyyntöjen tori palveluntuottajille (Jukka 17.9.2026): isännöitsijä vie pyynnön torille, hyväksytyt palveluntuottajat näkevät sen ja voivat varata työn itselleen. Luonteva ensimmäinen yhteinen näkymä palveluntuottajajärjestelmälle (edellinen kohta). Rajaukset:
  - Näkyvyys (Jukka vahvisti 17.9.2026): vain organisaatiolle tai yhtiölle hyväksytyt palveluntuottajat. Organisaatiolle hyväksytty näkee kaikkien isännöitävien yhtiöiden torille viedyt pyynnöt, yhtiölle hyväksytty vain sen yhtiön pyynnöt. Pohjana nykyinen `er_service_providers` ja portaalin `provider`-rooli; lisäksi ala- ja aluesuodatus (sähkö, putki, huolto; paikkakunta).
  - Tietojen minimointi: ennen varausta näkyvät ala, paikkakunta, kiireellisyys ja lyhyt kuvaus; osoite, huoneisto, kuvat ja ilmoittajan yhteystiedot vasta varaajalle (sama tehtävälinkki kuin tilauksessa, `/tehtava/[token]`).
  - Varaus: ensimmäinen varaaja saa työn (lukitus kannassa, ei kilpatilannetta), pyyntö poistuu muilta, isännöitsijä saa ilmoituksen ja voi perua varauksen. Varaamaton pyyntö palaa isännöitsijälle määräajan jälkeen.
  - Varauksen voimassaolo (Jukka vahvisti 17.9.2026): viikko. Varaaja ilmoittaa varatessaan arvioidun toteutusajankohdan. Jos työtä ei ole kuitattu tehdyksi viikon kuluessa varauksesta, varaus raukeaa ja pyyntö palaa torille; varaaja ja isännöitsijä saavat tiedon.
  - Tieto asukkaalle (Jukka vahvisti 17.9.2026): ilmoittaja näkee portaalissa ja saa viestin, mikä yritys työn varasi ja arvioidun toteutusajankohdan. Ajankohdan muutos päivittyy samaan näkymään.
  - Ei torille: kiireelliset viat (suoraan päivystäjälle) eikä yhtiöt, joilla on voimassa huoltosopimus, joka määrää tekijän.
  - Hinnat (Jukka vahvisti 17.9.2026): ei hinnastoa, työ laskutetaan toteuttajan omalla tuntihinnalla. Tuntihinta kirjataan palveluntuottajarekisteriin ja näytetään isännöitsijälle varauksen yhteydessä; toteutunut kustannus kirjataan tehtävälinkin kautta kuten nyt. Tarkennettava toteutuksessa: miten yhtiön euro-raja tarkistetaan ennen työtä (esim. varaaja antaa tuntiarvion).
  - Taloyhtiön päätös (Jukka vahvisti 17.9.2026): hallitus hyväksyy toimintatavan ja euro-rajan, esim. "alle 500 euron korjaukset saa tilata torilta hyväksytyiltä tekijöiltä". Toteutus: yhtiökohtainen asetus (tori käytössä, euro-raja, päätöspäivä ja viittaus hallituksen pöytäkirjaan). Ilman päätöstä yhtiön pyyntöjä ei voi viedä torille, ja rajan ylittävä työ vaatii isännöitsijän erillisen tilauksen.
  - Päätökset tehty 17.9.2026 (näkyvyys, taloyhtiön päätös, hinnat, varaus, tieto asukkaalle); toteutus voidaan aloittaa.

## Jatkokehitys (Jukan toiveet)
- [~] Pelastussuunnitelma-generaattori: taloyhtiön pelastussuunnitelma rekisterin tiedoista (rakennukset, lämmitys, yhteiset tilat, väestönsuoja, vastuuhenkilöt) täytettävänä pohjana ja PDF:nä, vuosipäivitys vuosikelloon (lähtötilanne 15.9.2026)
  - [x] Lähteet ja pakolliset sisältökohdat (PL 379/2011 14–15 §, VNa 407/2011 1–2 §, SPEKin pohja, Jukan aiemmat suunnitelmat) DECISIONS.md:hen
  - [x] Migraatio 0092: `er_rescue_plans` (versiot, luonnos/valmis, sisältö jsonb, valmiin version jäädytys), dokumenttiluokka `rescue_plan`, vuosikellon luokka `safety`; RLS- ja versiointitestit
  - [x] Esitäyttö rekisteristä, lomake osioittain (`/taloyhtiot/[id]/pelastussuunnitelma`), vaaratilanteet valintalistana, esikatselu-PDF, "Tallenna valmiina" dokumentiksi ja tarkistustehtävä vuosikelloon, yhtiön moduulikortti
  - [x] PDF `src/documents/RescuePlan.tsx` luonnosmerkinnällä, pohjapiirustukset liitteiksi, demodata ja savutestin reitit
  - [~] Vakiotekstien hyväksyntä (`RESCUE_PLAN_TEMPLATE_APPROVED`) – BLOCKERS 11
  - [ ] Rekisteriin omat kentät tiedoille, jotka nyt kirjoitetaan suunnitelmaan käsin (väestönsuoja, pääsulkujen sijainnit, kokoontumispaikka), jos niitä tarvitaan muuallakin (esim. isännöitsijäntodistus, huoltopyynnöt)
  - [x] Asukkaille tiedottaminen: valmiiksi merkitseminen luo tiedoteluonnoksen (osakkaat ja asukkaat suunnitelman näkyvyyden mukaan), jonka isännöitsijä tarkistaa ja julkaisee
  - [x] Isännöitsijäntodistukseen tieto pelastussuunnitelman olemassaolosta ja päiväyksestä (SPEKin opas suosittelee): voimassa oleva versio tai yhtiön asiakirja, myöhästynyt tarkistus mainitaan
