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

## 2026-09-15 M3 Talous

**Rahat kokonaisluvuilla.** Kanta palauttaa numeric-arvot tekstinä, ja laskenta tehdään BigInt-kokonaisluvuilla (hinta 10^4, määrä 10^4, summa sentteinä). Pyöristys senttiin tehdään vasta rivin lopuksi, puoli poispäin nollasta. Liukuluvuilla kuukausittain toistuvan laskun senttivirheet kertautuisivat.

**Viitteen järjestysnumero erillisessä taulussa `er_billing_unit_numbers`.** Numero jaetaan ensimmäisellä laskutusajolla tai maksutilanteen tuonnilla huoneistotunnusten luonnollisessa järjestyksessä (A 2 ennen A 10), ja myöhemmin lisätyt osakeryhmät saavat numerot suurimman käytetyn jälkeen. Aukkoja ei täytetä, jotta poistetun huoneiston viitteellä tuleva suoritus ei kohdistu toiseen huoneistoon. Erillinen taulu, koska rekisteritauluja ei muokata talouden roolilla eikä numero saa muuttua tunnuksen muuttuessa. Yhtiön numero (`er_company_billing_settings.company_number`) on uniikki organisaatiossa.

**Ensisijainen maksaja** on kauden ensimmäisenä päivänä voimassa olevista omistajista suurimman osuuden haltija (murtoluvut verrataan ristiin kertomalla), tasatilanteessa nimen mukaan aakkosjärjestyksessä ensimmäinen. Jos omistajaa ei ole, rivi syntyy ilman maksajaa ja ajoon tulee varoitus.

**Vastikeperusteen vaihtuminen kesken kuukauden** laskutetaan päivien suhteessa kahtena rivinä (vanha ja uusi hinta). Uusi peruste päättää saman vastikkeen (sama laji ja samat huoneistotyypit) edellisen perusteen alkupäivää edeltävään päivään; samana päivänä tai myöhemmin alkava peruste estää lisäyksen.

**Perusteiden määrät:** `area_m2` = huoneiston pinta-ala, `share` = osakemäärä, `unit` ja `fixed` = 1 kpl/kk osakeryhmää kohden, `person` = kauden alussa voimassa olevien asukkaiden määrä. `meter`-perusteista ei lasketa rivejä, koska mittarilukemia ei ole; ajoon tulee varoitus.

**Rahoitusvastike lainaosuudesta** (valinnainen ajokohtainen valinta) lasketaan tasalyhenteisenä ilman korkoa: jäljellä oleva osuus / kuukaudet lainan eräpäivään. Pankin maksuohjelma ja korko eivät ole eRapussa. Tavallisesti rahoitusvastike on vastikeperuste €/osake/kk, jolloin valintaa ei käytetä.

**Lainaosuuslaskelma:** osuus pyöristetään alaspäin senttiin ja jäännössentit annetaan yksi kerrallaan suurimmille osakeryhmille (tasatilanteessa tunnuksen järjestyksessä), jolloin osuudet summautuvat täsmälleen lainaan. Alkuperäinen osuus jaetaan pääomasta kaikille, jäljellä oleva saldosta niille, joilla ei ole kertasuoritusta. Kertasuorituksen rivejä ei lasketa uudelleen.

**Hallitus ei näe osakaskohtaista maksutilannetta eikä laskutusrivejä.** RLS: hallitus lukee hyväksytyt ajot (totals-kentässä vain summat ja huoneistotunnuksin varoitukset, ei nimiä) ja maksutilanteen summat security definer -funktiolla `er_board_payment_summary`. Osakas (rooli owner, ei asukas) lukee oman osakeryhmänsä rivit vasta hyväksytystä ajosta ja oman maksutilanteensa; kauden päivät funktiolla `er_portal_billing_run_periods`.

**Oikeudet:** talouden kirjoitukset kaikille henkilökunnan rooleille kuten 0004:ssä (kirjanpitäjä tekee talouden toimenpiteet). Laskutusajon hyväksyy owner, manager tai accountant, ei assistentti. Kirjanpitoon viety ajo ei ole peruttavissa, vaan korjataan hyvityksellä kirjanpidossa.

**Kirjanpitoadapteri** `src/lib/finance/accounting`: `KirjanpitoAdapteri` (`exportBillingRun`, `importPaymentStatus`), käytössä CSV. Vienti on UTF-8 BOM, puolipiste, CRLF, desimaalipilkku ja p.k.vvvv; sarakkeet dokumentoitu `csv.ts`:ssä. Procountorin tarkkaa tuontipohjaa ei tiedetä (TODO). Viety CSV tallennetaan `er_documents`-riviksi (category `other`, näkyvyys `internal`, subject `er_billing_runs`) ja ladataan `/api/dokumentit/[id]`. PPR-adapteri on runko, joka heittää virheen.

**Maksutilanteen tuonti** kohdistaa viitteellä (kotimainen tai RF), toissijaisesti huoneiston tunnuksella; saman osakeryhmän rivit lasketaan yhteen. Tiedostosta puuttuvat osakeryhmät saavat samalle päivälle nollasaldon, koska reskontraraportissa ovat vain avoimet erät. Kohdistamattomat rivit tallennetaan tuontiin ilman nimiä. Virheellinen rivi (summa tai päivä) hylkää koko tiedoston, jotta osittainen maksutilanne ei näytä väärää kuvaa.
