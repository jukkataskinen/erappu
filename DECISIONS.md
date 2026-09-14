# eRappu – DECISIONS

## 2026-09-14

**Jukan päätökset (suunnitelma v0.4 ja yöistunto):** järjestelmätoimittaja ja MML-sopimusosapuoli on Adepta Tilat Oy. Adepta Oy myy eSinetin Adepta Tilat Oy:lle. Asiakasyhtiöitä on 11. Kirjanpito Procountorissa 31.12.2027 asti ja sen jälkeen suoraan Adepta PPR:ssä. Henkilökunta: Jukka isännöitsijänä ja kaksi kirjanpitäjää. Huoltopyyntöjen pilotit: As Oy Paikkalankartano Matti ja As Oy Jussilantie 6. Hoitovastike €/m²/kk. Ulkoasu Reilusopparin mukaan.

**Kieli ja nimeäminen eSinetin ja Reilusopparin mukaan:** taulut ja koodi englanniksi etuliitteellä `er_`, käyttöliittymä suomeksi. Suunnitelman `schema_v0.sql` oli suomeksi; käännetty, koska portfolion uusimmat tuotteet noudattavat tätä ja jaettavat osat (eSinetti-asiakas, tunnistus) ovat englanniksi.

**RLS on todellinen suojaus, ei varmistus.** Portfolion muissa sovelluksissa kutsut tehdään service role -avaimella ja eristys on koodissa; PPR:ssä ja jaetussa Supabase-projektissa se on vuotanut. eRapussa jokainen käyttäjän pyyntö ajetaan transaktiossa roolilla `authenticated` ja JWT-väitteellä `sub` (Supabasessa `auth.jwt()`), jolloin unohtunut ehto koodissa ei vuoda. Tämän vuoksi kantakutsut ovat suoraa SQL:ää eivätkä supabase-js-kutsuja.

**PGlite paikalliseen kehitykseen ja testeihin.** Koneella ei ole Dockeria eikä Supabase CLI:tä. PGlite on oikea Postgres (WASM), joten migraatiot, exclusion constraintit ja RLS toimivat samoin kuin Supabasessa. Paikallinen jäljitelmä luo roolit `anon/authenticated/service_role` ja funktion `auth.jwt()`.

**Osakevälien päällekkäisyys estetään kannassa** (`exclude using gist … int4range`), ja osakeryhmän osakemäärä lasketaan väleistä triggerillä. Accessissa molemmat olivat käsin syötettyjä ja ristiriitaisia.

**Omistusosuudet murtolukuina** (osoittaja/nimittäjä) kuten HTJ:ssä; 1/3 ei pyöristy.

**Moduulien nostot `src/widgets/<moduuli>.tsx`-tiedostoissa**, jotta rinnakkain rakennettavat moduulit eivät muokkaa samaa työpöytä- tai etusivutiedostoa.

**Lomakevirheet `?virhe=`-parametrilla** ilman lomakkeen sisältöä, jotta henkilötietoa ei päädy osoiteriville tai lokeihin.

## 2026-09-15 M2 HTJ ja korjaukset

**HTJ:n sisäinen tietomalli ja adapteri** (`src/lib/htj/types.ts`, `client.ts`, `mml.ts`). MML:n polkuja ja JSON-skeemoja ei ole saatavilla, joten sovellus käyttää vain omia tyyppejä ja `mml.ts` muuntaa vastaukset. Arvaukset on merkitty `TODO(MML-skeema)`. `HTJ_MODE=mml` ilman varmennetta on konfiguraatiovirhe eikä putoa jäljitelmään, jotta tuotannossa ei koskaan verrata rekisteriä kuvitteelliseen dataan.

**Mitään ei kirjoiteta rekisteriin ilman hyväksyntää.** Haku tallentaa erot (`er_htj_diffs`), ja hyväksyntä kirjoittaa ne. Ensimmäisessä vertailussa myös täsmäävät rivit tulevat erona ("merkitään HTJ-peräiseksi"), koska vasta hyväksyntä asettaa `source='htj'` ja `htj_id`. Uusi haku merkitsee käsittelemättömät erot tilaan `superseded` (lisätty tehtävänannon tilojen lisäksi).

**Hyväksyttävä erä on yksi transaktio.** Erot kirjoitetaan järjestyksessä: päättyvät omistukset, poistuvat osakeryhmät, muutokset, uudet. Muuttuvat osakevälit poistetaan ensin kaikilta, jotta välien vaihto kahden osakeryhmän kesken ei kaadu päällekkäisyyden estoon. Jos yksi ero ei mene läpi, mitään ei kirjoiteta ja virhe nimeää eron.

**Omistajanvaihdos on kaksi eroa** (vanha päättyy, uusi alkaa). Päättyvän omistuksen `ends_on` on edellinen päivä, ja samalla päättyy omistajan asuminen huoneistossa (`role='owner'`), vuokralaisen ei. Omistajat yhdistetään omistusmerkinnän tunnisteella, omistajan HTJ-viitteellä (`er_parties.htj_id`) ja lopuksi nimellä (järjestys ja kirjainkoko eivät ratkaise).

**Henkilötunnusta eikä syntymäaikaa tallenneta.** Omistajat haetaan aina suppealla haulla, ja `stripPersonalIds` poistaa tunnuksen jo rajapintakerroksessa. Syntymäaikaa ei kopioida eroihin eikä `er_party_identifiers`-tauluun, koska tässä moduulissa sitä ei tarvita; portaalitunnistus voi hakea sen myöhemmin. Uudelle osapuolelle tallennetaan VTJ-osoite, ellei henkilöllä ole turvakieltoa; olemassa olevan osapuolen yhteystietoja ei korvata.

**Hakuloki `er_htj_requests`** sisältää operaation, Y-tunnuksen, suppea/laaja, tarkoituksen, lopputuloksen ja rivimäärän, ei vastauksen sisältöä. Loki kirjoitetaan samaan transaktioon kuin synkronointi; HTJ-virhe merkitsee synkronoinnin virheeksi ilman poikkeusta, jolloin lokirivi säilyy. Lokia lukevat vain pääkäyttäjä ja isännöitsijä, eikä sitä voi muuttaa käyttäjäroolilla.

**Roolit kannassa:** haku ja erojen hyväksyntä vain `owner`/`manager`; HTJ2-ilmoituksen luonnos myös `accountant`/`assistant`, mutta hyväksyntä, lähetys ja käsin tehdyksi merkitseminen vain `owner`/`manager` (RLS-politiikat `prepare_*` ja `manager_all`, lisäksi check `status = 'draft' or approved_by is not null`).

**HTJ2-velvollisuus:** huoneistoiksi lasketaan asuin- ja liikehuoneistot. Laina on jaettava, jos `allocated` ja saldo > 0 tai tuntematon (varmuuden vuoksi). KPTS-ikkuna on kuluva vuosi + 5. Ilmoitusten kokonaistila: avoin luonnos → "Luonnos", muuten viimeisin rivi ratkaisee ("Lähetetty" / "Merkitty käsin tehdyksi" / "Hylätty"); uudet ilmoittamattomat rivit näytetään erikseen.

**"Merkitse ilmoitetuksi käsin"** tekee jokaisesta lajista, jossa oli ilmoittamattomia rivejä, jonoon rivin `manual_done` (sisältönä ilmoitetut rivit) ja asettaa riveille `htj_submitted_at`. Näin jäljistä näkyy, mitä ilmoitettiin ja kuka merkitsi. Muokattu kunnossapitotyö ja siirretty KPTS-rivi menettävät merkinnän ja ilmoitetaan uudelleen.

**Muutostyöilmoituksen viesti isännöitsijälle** lisätään SECURITY DEFINER -funktiolla `er_notify_renovation_notice` (0021) samassa transaktiossa kuin ilmoitus, koska osakas ei näe isännöitsijän osoitetta eikä voi kirjoittaa viestijonoon. Funktio hyväksyy vain kutsujan oman ilmoituksen, lisää viestin kerran, eikä viestissä ole osakkaan henkilötietoja. Vastaanottaja on vastuuisännöitsijä tai, jos sitä ei ole, organisaation pääkäyttäjät ja isännöitsijät. Käsittelyn tilamuutoksista ilmoittaja saa viestin osapuolen sähköpostiin.

**Muutostyön valmistuminen** luo kunnossapitotyön (`performed_by='shareholder'`, `source='renovation_notice'`), ja KPTS-rivin valmistuminen yhtiön työn. Tuntematon työlaji kirjataan "Muu". Työlajiluettelo (`work-types.ts`) on HTJ-yhteensopivaksi tarkoitettu, koodit täydennetään koodiston tultua.

**Muutostietojen yöajo** (`/api/cron/htj`, `Authorization: Bearer CRON_SECRET`) hakee muutokset organisaatioittain edellisestä onnistuneesta ajosta ja tekee muuttuneille yhtiöille uuden vertailun. Erot jäävät hyväksyttäviksi eikä niitä kirjoiteta automaattisesti (suunnitelman "HTJ voittaa" toteutuu hyväksynnän kautta). Mukana vain yhtiöt, joiden alkulataus on tehty.
