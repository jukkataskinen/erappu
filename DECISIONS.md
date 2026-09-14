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

## 2026-09-15 M5 Kokoukset ja todistukset

**Asialistapohjat ovat koodissa (`src/lib/meetings/templates.ts`), eivät siemenriveinä.** Pohjat ovat samat kaikille organisaatioille; migraatio ei voi luoda organisaatiokohtaisia rivejä. Organisaatio voi tallentaa oman oletuspohjansa tauluun `er_agenda_templates`, ja se ohittaa vakion. Varsinaisen yhtiökokouksen pohja noudattaa AOYL 6:10 §:ää (ml. kunnossapitotarveselvitys 6:10 § 3 mom.). **Luonnos: Jukan tarkistettava** (BLOCKERS 4).

**Äänileikkuri lasketaan kerran edustettujen täysistä äänistä** (`src/lib/meetings/votes.ts`): raja = floor(1/5 × läsnä ja edustettuina olevien osakkeiden äänet), ja jokainen ääniluettelon rivi (osakas tai yhteisomistajat yhdessä, asiamiehen kautta tai itse) leikataan siihen. Raja ja äänet/osake ovat parametreja, koska yhtiöjärjestys voi poiketa. Tulkinnat (leikkaus per ääniluettelon rivi, pyöristys alaspäin, yhteisomistajat yhtenä rivinä) Jukan tarkistettavia.

**Kutsuaika näytetään ohjeena, ei estona:** aikaisintaan 2 kk ja viimeistään 2 viikkoa ennen (AOYL 6:18 §), koska yhtiöjärjestys voi määrätä toisin. Sähköinen kutsu vain osakkaalle, jolla on `electronic_notice_consent` ja kelvollinen sähköposti; muut näytetään tulostettavana paperikutsulistana. Hallituksen kokouksen kutsuun suostumusta ei vaadita.

**Pöytäkirjat renderöidään eRapussa (@react-pdf), ei eSinetin pohjamoottorilla.** Suunnitelman osio 09 ehdotti eSinetin `/documents/render`-pohjia, mutta CLAUDE.md:n lukittu päätös on, että eRappu tekee PDF:n itse. Asiakirjakerros (`src/documents`) on kopioitu Reilusopparista (deterministinen renderöinti, fontit, QR) ja brändätty eRapuksi. Isännöinnin asiakirjoissa ei ole Reilusopparin kuvitusta.

**eSinetti-asiakkaan tila valitaan `ESINETTI_MODE`:lla** (Reilusopparissa avaimen olemassaololla), jotta tila on eksplisiittinen kuten HTJ:ssä ja sähköpostissa. Tuotannossa mock kaatuu (`assertRealEsinetti`). Mockin tila on `globalThis`issä, jotta Nextin kehityspalvelin ei hukkaa kierroksia. "Simuloi allekirjoitus" -nappi ajaa saman käsittelyn kuin webhook, vain kun `ESINETTI_MODE != http` ja `NODE_ENV != production`.

**Webhookin idempotenssi kahdella tasolla:** tapahtuman id uniikkina tauluun `er_webhook_events` samassa transaktiossa kuin tilamuutos, ja valmista kierrosta ei käsitellä uudelleen (uusi tapahtuma-id samalle kierrokselle → "ignored"). Sinetöity PDF ladataan ja tallennetaan ennen transaktiota; jos tapahtuma osoittautuu toistoksi, tiedosto poistetaan. Kierros yhdistetään kokoukseen `external_ref`-arvolla `erappu:meeting:<uuid>`, ja sen on vastattava kierrosrivin kohdetta.

**Allekirjoittamaton pöytäkirja on sisäinen dokumentti;** vasta sinetöity versio julkaistaan osakkaille (yhtiökokous) tai hallitukselle (hallituksen kokous). Kokouskutsu näkyy osakkaille heti. Osakas- ja ääniluettelo ovat hallituksen näkyvyydellä, koska niissä on osakkaiden nimet. `er_meetings`-RLS: osakas näkee yhtiökokoukset tilasta `notice_sent` alkaen, hallitus kaikki paitsi luonnokset; asiat näkyvät niille, jotka näkevät kokouksen.

**Pöytäkirjantarkastajien sähköpostit tallennetaan kokoukselle (`minutes_checkers` jsonb)** eikä osapuoliin, koska tarkastaja voi olla kuka tahansa kokouksessa läsnä ollut, eikä hänellä välttämättä ole osapuoliriviä.

**Kokousaika syötetään Helsingin aikana ja muunnetaan sovelluksessa** (`src/lib/meetings/time.ts`), jotta muunnos ei riipu kannan aikavyöhyketiedoista (PGlite/Supabase).

**Isännöitsijäntodistus on luonnos** (`CERTIFICATE_TEMPLATE_APPROVED = false` → "LUONNOS – sisältö tarkistettava" PDF:ssä). Rakenne VNa 365/2010 mukaan (I yhtiö, II huoneisto, III talous, IV korjaukset, V rajoitukset, HTJ-merkintä). Omistajia ei tulosteta, koska omistus- ja panttaustiedot ovat HTJ:ssä. Vastikkeet lasketaan voimassa olevista `er_charge_bases`-riveistä (€/m² × ala, €/osake × osakkeet, kiinteä). Maksutilanne luetaan M3:n taulusta `er_payment_status` vain, jos se on olemassa: tarkistus `to_regclass`illa ja kysely tallennuspisteen sisällä, koska epäonnistunut kysely keskeyttäisi muuten koko transaktion.

**Julkinen todistustilauslinkki on yhtiökohtainen ja voimassa vuoden;** uusi linkki mitätöi vanhan. Token näytetään henkilökunnalle vain luontihetkellä lyhytikäisessä, allekirjoitetussa ja polkuun rajatussa evästeessä, ei osoiterivillä. Lomakkeessa on kevyt muistinvarainen rajoitin (linkki 20/h, IP 5/10 min) ja roskapostiansa. Tilaajalle ei lähetetä todistusta eikä latauslinkkiä (BLOCKERS 9). Hinnat 120 € / pika 180 € ovat paikkamerkkejä.

**JSX-pragma (`@jsxRuntime automatic`) PDF-komponenteissa ja niiden testeissä.** Vitest ei käytä Nextin kääntäjää, ja `tsconfig`in `jsx: preserve` jättää JSX:n muuten klassiseen muunnokseen (`React is not defined`). Pragma välttää yhteisen `vitest.config.mts`:n muuttamisen.
