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