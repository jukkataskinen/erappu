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

## 2026-09-15 M1 Huolto

**Juokseva numero laskuritaululla.** `er_service_request_counters`-rivin upsert lukitsee rivin, joten samanaikaiset pyynnöt eivät saa samaa numeroa. Sequence per organisaatio olisi vaatinut DDL:ää ajon aikana.

**Roolirajat kannassa triggerillä ja funktiolla.** Portaalista luodun pyynnön käsittelytiedot (tila, vastuuhenkilö, palveluntuottaja, kustannus) pakotetaan oletuksiin triggerissä; kirjanpitäjän päivitys rajataan kustannussarakkeisiin. Ilmoittajan kuittaus ja uudelleenavaus tehdään security definer -funktiolla `er_service_request_reporter_action`, koska portaalikäyttäjällä ei ole UPDATE-oikeutta pyyntöön. Luontitapahtuma kirjataan aina triggerissä.

**Tapahtumien näkyvyys.** `internal` vain henkilökunta, `reporter` ilmoittaja ja hallitus, `board` hallitus, `provider` palveluntuottaja tehtävälinkissä. Palveluntuottaja näkee lisäksi tilamuutokset ja omat merkintänsä, ei ilmoittajan ja isännöinnin välisiä kommentteja. Tilamuutostapahtuma on aina `reporter`-näkyvyyttä; siihen liittyvä kommentti on erillinen tapahtuma valitulla näkyvyydellä. Tapahtumatyyppeihin lisättiin `cost`.

**Palveluntuottaja ei kirjaudu.** Tehtävälinkki (30 pv) ratkaistaan palvelun roolilla, ja kaikki kyselyt rajataan linkin organisaatioon ja pyyntöön. Uusi tilaus tai palveluntuottajan vaihto mitätöi aiemman linkin. Linkissä näkyy ilmoittajan puhelin vain, jos ilmoittaja antoi sen; muita henkilötietoja ei. Kuvat haetaan omalla reitillä `/tehtava/[token]/kuva/[id]`.

**Julkisen lomakkeen linkki salattuna.** Linkki tulostetaan QR-koodina, joten henkilökunnan pitää voida näyttää se uudelleen: token tallennetaan tiivisteen lisäksi `encryptField`-salattuna tauluun `er_public_request_forms`. Linkin vaihto mitätöi vanhan heti.

**Kutsurajoitin kantaan, ei muistiin.** Vercelin funktioilla ei ole yhteistä muistia. Kiinteä tunnin ikkuna, 5 lähetystä per IP-osoitteen HMAC per organisaatio, taulu vain palvelun roolille. Toisin kuin Reilusopparissa virhe ei päästä kutsua läpi, koska julkinen lomake ilman rajaa on roskapostin reitti. Lisäksi piilokenttä roskapostiansana.

**Kuvat pienennetään selaimessa ja siivotaan palvelimella.** Palvelintoiminnon oletusraja (1 Mt) säilytettiin: selain pienentää kuvan 1600 px JPEG:ksi, ja palvelin hyväksyy vain JPEG/PNG:n ja poistaa EXIF/XMP/tekstilohkot itse, koska selaimen vaiheen voi ohittaa. Enintään 3 kuvaa kerralla.

**Ilmoitukset lyhyinä.** Viestissä on numero, aihe, yhtiö, tila ja linkki, ei pyynnön kuvausta eikä henkilötietoja. Ilmoittajan omasta toiminnosta ei ilmoiteta. Portaalin ilmoittajan sähköposti tallennetaan pyyntöön luontihetkellä, koska henkilökunta ei näe portaalikäyttäjän käyttäjäriviä. Julkisella lomakkeella vesivahinko merkitään kiireelliseksi automaattisesti.

**Hallitus näkee yhtiön pyynnöt ilman ilmoittajan yhteystietoja.** RLS antaa rivin, mutta portaalinäkymä ei näytä ilmoittajan nimeä, puhelinta tai sähköpostia muille kuin henkilökunnalle.