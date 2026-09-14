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

## 2026-09-15 M6 Arki

**Toistuvasta tehtävästä on kannassa vain yksi avoin esiintymä.** Seuraava luodaan kuittauksessa samaan sarjaan (`series_id`), ja uniikki indeksi `(series_id, due_on)` estää tuplat. Myöhästynyt tehtävä ei katoa listalta, eikä kantaan synny vuosien tehtävärivejä etukäteen.

**Toistuvuus ilman RRULE-kirjastoa:** vuosittain/kuukausittain/viikoittain + väli. `by_month_day` tallennetaan luotaessa (−1 = kuun viimeinen päivä), jotta 31. päivän tehtävä ei valu 28. päivään helmikuun jälkeen ja karkauspäivä palaa karkausvuonna.

**Vakiovuosikellon määräajat tilikauden päättymisestä, kuun viimeinen päivä säilyy:** tilinpäätös +3 kk, tilin-/toiminnantarkastus ja kunnossapitotarveselvitys +4 kk, varsinainen yhtiökokous +6 kk (AOYL 6:10 §), HTJ-päivitys +7 kk, vakuutukset +10 kk, talousarvio +11 kk. Jokaisesta pohjasta luodaan seuraava esiintymä tästä päivästä eteenpäin. Energiatodistus: uusiminen 1.7. vuonna todistusvuosi + 9 (toistuu 10 v); jos vuotta ei ole rakennuksen tiedoissa, kertaluonteinen tarkistustehtävä. Juridiset ajat ovat Jukan tarkistettavissa, mutta muut kuin 6 kk ovat käytäntöjä eivätkä lain määräaikoja.

**Varausten yksityisyys funktiolla eikä sarakeoikeuksilla.** Portaalikäyttäjä lukee `er_bookings`-riveistä vain omansa; muiden varaukset hän näkee `er_resource_bookings()`-funktiosta (security definer), joka palauttaa vain ajan ja tiedon "oma/ei oma". Organisaatio ja yhtiö otetaan triggerissä resurssilta, portaalin varaukselle tarkistetaan kannassa ajankohta, vakiovuoron salliminen ja kiintiö (advisory lock huoneisto+kohde), ja päivitystriggeri sallii portaalikäyttäjälle vain oman varauksen perumisen. Henkilökunta ohittaa kiintiön.

**Kiintiössä vakiovuoro (12 viikkoa) lasketaan yhdeksi varaukseksi** (`count(distinct series_id)`), muuten vakiovuoro ei olisi mahdollinen pienellä kiintiöllä.

**Varausvuorot seinäkelloajassa (Europe/Helsinki).** Kevään siirrossa olematon alkuhetki ohitetaan, syksyllä kahdesti esiintyvä hetki tulkitaan kesäajaksi, jolloin vuorot eivät mene päällekkäin eivätkä jätä aukkoa. Vakiovuoro säilyttää kellonajan kesäajan vaihtuessa.

**Muistutukset:** tänään erääntyvä tehtävä muistutetaan kerran, myöhässä oleva enintään kerran viikossa (`last_reminded_on`), yksi koosteviesti vastaanottajaa kohden. Vastuuhenkilön puuttuessa muistutus menee yhtiön isännöitsijälle. Sopimusmuistutus kerran (`reminded_at`), ja se nollautuu, kun muistutuspäivä muuttuu. Muistutuspäivä oletuksena 30 pv ennen irtisanomisen viimeistä päivää, tai ennen päättymistä, jos irtisanomisaikaa ei ole.

**Kulutuslukemat jaksoina, kuukausille päivien suhteessa.** Laskut eivät osu kalenterikuukausiin. MWh muunnetaan kWh:ksi vertailussa. Kesken olevaa vuotta verrataan edellisen vuoden samoihin kuukausiin. CSV-tuonti on kaikki tai ei mitään; sama yhtiö, laji ja jakso päivitetään, jotta tuonnin voi ajaa uudelleen. Kulutus m² kohden asuin- ja liikehuoneistojen pinta-alasta.

**Kulutus-sivulla ei ole omaa navigaatiolinkkiä** (nav.ts on yhteinen); se linkitetään vuosikellosta ja sopimuksista.
