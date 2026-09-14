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

## 2026-09-15 M7 Asetukset ja portaali

**Kutsu sidotaan sähköpostiin, ei pelkkään linkkiin.** Token (256 bittiä, kantaan vain sha256, 14 pv, kertakäyttöinen, peruttava) ei yksin riitä: kirjautuneen käyttäjän sähköpostin on vastattava kutsua kirjainkoosta riippumatta (Auth0:ssa vain vahvistettu osoite, kehityksessä er_users.email). Siksi viestijonoon (er_outbound_messages.body) jäävä linkki ei avaa oikeuksia, vaikka henkilökunta näkee jonon. Viestirungon tyhjennys lähetyksen jälkeen kannattaa silti tehdä viestintämoduulissa.

**er_invitations laajennettiin migraatiolla 0070** (party_id, company_id, revoked_at, accepted_by, last_sent_at) ja muotorajoitteella: henkilökuntakutsussa organisaatiorooli, portaalikutsussa osapuoli ja yhtiö. Uudelleenlähetys vaihtaa saman rivin tokenin, jolloin vanha linkki lakkaa toimimasta. Samalle osoitteelle/osapuolelle jää voimaan vain uusin kutsu.

**Pääkäyttäjäksi voi kutsua vain pääkäyttäjä,** ja tämä on myös rajoittavana RLS-politiikkana, koska muuten isännöitsijä voisi korottaa itsensä toisella tunnuksella. **Viimeistä pääkäyttäjää ei voi poistaa eikä alentaa** (trigger er_protect_last_owner + tarkistus sovelluksessa); organisaation poisto cascade-ketjussa sallitaan.

**Jäsenten roolit, poistot ja organisaation tiedot muuttaa vain pääkäyttäjä** olemassa olevan RLS:n mukaisesti (members_owner_write, org_owner_update). Isännöitsijä näkee asetukset, kutsuu henkilökuntaa (paitsi pääkäyttäjiä) ja portaalikäyttäjiä sekä näkee lokin. Muille rooleille /asetukset on 404.

**Organisaation yhteystiedot ja todistushinnat settings-jsonb:ssä** avaimilla `contact.{phone,email,street_address,postal_code,city}` ja `certificate_prices.{standard_eur,express_eur}` (M5 lukee). Päivitys yhdistää (`||`), jotta muiden moduulien avaimet säilyvät.

**Portaalin isännöitsijätiedot palvelun roolilla.** Portaalikäyttäjä ei näe er_users- eikä er_organizations-rivejä. Kysely rajataan käyttäjän voimassa oleviin er_portal_access-yhtiöihin (käyttäjä istunnosta) ja palauttaa vain vastuuisännöitsijän nimen, sähköpostin ja puhelimen sekä isännöintiyrityksen nimen ja yhteystiedot, jotka ovat osakkaille kuuluvia tietoja.

**Sähköisen kokouskutsun suostumus palvelun roolilla, rajattuna.** Portaalikäyttäjälle ei anneta er_parties-kirjoitusoikeutta (muuten hän voisi muuttaa nimeä tai käyttäjäliitosta). Päivitys koskee vain rivejä, joiden user_id on istunnon käyttäjä, ja vain yhtä saraketta; audit-lokiin. Osakevälit näytetään /portaali/oma-sivulla vain omistajalle, vaikka RLS sallii ne myös asukkaalle.

**Tapahtumalokin näkymä ei hae details-kenttää** lainkaan, ja suodattimet hyväksyvät vain tunnisteen muotoiset arvot. **Integraationäkymä lukee vain tilamuuttujat** eikä kaiuta tuntematonta arvoa (väärin asetettu avain tilamuuttujassa ei päädy näkyviin).

**Portaalikutsun nappi on client-komponentti (useActionState),** jotta rekisterisivujen muutos pysyy pienenä eikä sivujen tarvitse lukea uusia URL-parametreja.
## 2026-09-15 M4 Viestintä ja dokumentit

**Hallitus laatii, isännöitsijä julkaisee.** `er_announcements.origin = 'board'` ja RLS sallii hallitukselle vain tilan `draft` omaan yhtiöön ja oman luonnoksen muokkauksen. Julkaisu lähettää sähköpostia yhtiön nimissä, joten sen tekee pääkäyttäjä tai isännöitsijä (sovelluskerros); assistentti voi laatia luonnoksia. Henkilökunnan keskeneräiset luonnokset eivät näy hallitukselle.

**Kohderyhmä tarkistetaan kannassa funktiolla `er_portal_audience_match`.** Osakas/asukas näkee julkaistun, voimassa olevan tiedotteen vain, jos hänen portaalioikeutensa rooli on kohderyhmässä ja rakennusrajauksessa hänen osakeryhmänsä rakennus. Hallitus näkee yhtiön kaikki julkaistut tiedotteet, eikä rakennusrajaus koske hallitusta, koska se on koko yhtiön elin.

**Vastaanottajat rekisteristä, yksi viesti osoitetta kohden.** Omistukset, asumiset ja hallitusjäsenyydet yhdistetään osapuoliksi ja sähköpostit normalisoidaan (pienet kirjaimet); pariskunnan yhteinen osoite saa yhden viestin. Julkaisuhetken määrät (henkilöt, sähköpostit, ilman sähköpostia) tallennetaan tiedoteriville, nimiä ei tallenneta eikä lokiteta. Sähköpostin lähetykseen ei vaadita `electronic_notice_consent`-suostumusta, koska tiedote ei ole muodollinen yhtiökokouskutsu; kokouskutsuissa (M5) suostumus on tarkistettava.

**Henkilötunnusvahti tiedotteisiin.** Otsikosta ja tekstistä etsitään kelvolliset henkilötunnukset ennen tallennusta, koska tiedote lähtee sähköpostina kymmenille vastaanottajille.

**Dokumentin poisto vain pääkäyttäjälle ja isännöitsijälle (migraatio 0041).** 0003:n `staff_write` jaettiin insert/update (myös kirjanpitäjä ja assistentti) ja delete (owner, manager) -politiikoiksi. Sinetöityä dokumenttia ei poisteta. Tiedosto poistetaan varastosta vasta rivin poiston jälkeen: epäonnistuminen jättää orvon tiedoston, ei rikkinäistä linkkiä.

**Huoneistokohtaisen dokumentin näkyvyys korjattu (0041).** 0003:ssa vuokralainen näki myös huoneistonsa osakkaille tarkoitetut dokumentit, koska `er_portal_share_group_ids()` ei erottele roolia. Uusi `er_portal_share_group_ids_for(roles)`: osakas näkee huoneistonsa owners- ja residents-dokumentit, asukas vain residents.

**Lataus reitillä `/api/dokumentit/upload`, ei server actionilla.** Server actionien runkoraja on 1 Mt ja dokumentit enintään 20 Mt. Reitti tarkistaa Origin-otsakkeen itse ja ohjaa takaisin 303:lla. Middleware katkaisee oletuksena yli 10 Mt:n rungot, joten `next.config.ts`:iin lisättiin `experimental.middlewareClientMaxBodySize: "21mb"` (yhteinen tiedosto, ainoa tapa saada 20 Mt:n raja toimimaan).

**Tiedostonimi: näyttönimi säilyttää ääkköset, varaston avain on ASCII.** `sanitizeFileName` käytti NFKD-normalisointia, jolloin "Tilinpäätös" tallentui muotoon "Tilinpaatos". Korjattu NFKC:ksi; varastopolkuun käytetään ASCII-muotoa, koska Supabase Storage ei hyväksy kaikkia merkkejä avaimissa.

**Viestijonon purku.** `/api/cron/viestit` (GET/POST) vaatii `Authorization: Bearer ${CRON_SECRET}`; tuotannossa ilman salaisuutta reitti on kiinni, kehityksessä auki. Jono puretaan 50 viestin erissä, kukin omassa transaktiossaan. Henkilökunnan "Lähetä jono nyt" ja julkaisun jälkeinen välitön lähetys rajataan oman organisaation viesteihin (`dispatchQueued`-funktion uusi valinnainen `organizationId`). Jononäkymässä vastaanottajasta näytetään vain verkkotunnus.

**Perusdokumenttien puuttuminen.** Yhtiöjärjestys puuttuu, jos sitä ei ole. Tilinpäätös odotetaan heinäkuusta alkaen edelliseltä vuodelta ja sitä ennen toissavuodelta (yhtiökokous kuuden kuukauden kuluessa tilikauden päättymisestä; oletus tilikausi = kalenterivuosi). Energiatodistus on vanhentunut, kun uusin on yli kymmenen vuotta vanha; vuodeton todistus hyväksytään.
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