# eSinetin käyttöönotto allekirjoituksiin

eRappu lähettää allekirjoitettavaksi kokouspöytäkirjat ja sopimuserät sekä sinetöi isännöitsijäntodistukset. Tuotannossa `ESINETTI_MODE=mock` tarkoittaa, että allekirjoitus **estyy** kokonaan (`assertRealEsinetti`), joten käyttöönotto on nämä kuusi vaihetta.

Tilan näkee eRapussa kohdasta **Asetukset → Integraatiot**: rivi eSinetti kertoo tilan ja sen, mitkä muuttujat puuttuvat.

## 1. Organisaatio eSinettiin

1. Kirjaudu `https://app.esinetti.fi`.
2. Jos organisaatiota ei vielä ole, palvelu ohjaa kohtaan **/onboarding**: anna nimi (Adepta Tilat Oy) ja tyyppi. Luoja saa roolin `owner`, ja organisaatiolle syntyy samanniminen yhtiö.
3. Kutsu tarvittavat työkaverit kohdasta **Käyttäjät** (roolit `owner`, `admin`, `member`). API-avaimia ja asetuksia hallitsevat vain `owner` ja `admin`.

## 2. Organisaation asetukset (/settings)

- **Lähettäjän nimi** näkyy allekirjoituspyyntöjen sähköposteissa. Aseta esimerkiksi "Adepta isännöinti".
- **Logo ja tunnusväri** näkyvät allekirjoitussivulla.
- **Arkiston säilytysaika** 1–10 vuotta (oletus 10). Sinetöity PDF säilyy tämän ajan; alkuperäinen sinetöimätön poistetaan aina 30 päivässä.
- **Kuukausikatto** rajaa vahvojen tunnistusten määrän. Tyhjä = oletuskatto.

## 3. Webhook eRappuun

eRappu saa tiedon allekirjoituksista vain webhookilla. Ilman sitä sinetöity pöytäkirja ei tallennu dokumentteihin eikä kokouksen tila muutu.

1. eSinetin **/settings** → kenttä **Webhook-osoite**: `https://www.erappu.fi/api/esinetti/webhook` (vain https kelpaa).
2. Samalta sivulta **Luo uusi salaisuus**. Kopioi salaisuus talteen: se menee eRapun muuttujaan `ESINETTI_WEBHOOK_SECRET`.

eSinetti allekirjoittaa jokaisen kutsun otsakkeella `X-eSinetti-Signature: t=<unix>,v1=<hmac>`, ja eRappu hylkää kutsun, jos allekirjoitus tai aikaleima ei täsmää (sallittu poikkeama 5 min). Epäonnistunut toimitus uusitaan 1 min, 5 min, 30 min, 2 h, 12 h ja 24 h kuluttua.

## 4. API-avain

1. eSinetin **/api-keys** → **Luo avain**, anna nimeksi esimerkiksi "eRappu tuotanto".
2. Kopioi avain (`sk_live_…`) heti: sitä ei näytetä uudelleen. eSinetti tallentaa siitä vain tiivisteen.
3. Avain antaa täyden pääsyn organisaation kaikkiin rajapinnan toimintoihin, joten se on salaisuus. Avaimen voi mitätöidä ja luoda uuden samalta sivulta.

## 5. Muuttujat eRappuun (Vercel)

Aseta tuotantoympäristöön (Vercel → Settings → Environment Variables → Production):

```
ESINETTI_MODE=http
ESINETTI_API_URL=https://app.esinetti.fi/api/v1
ESINETTI_API_KEY=sk_live_...
ESINETTI_WEBHOOK_SECRET=...
```

Tee muutosten jälkeen uusi käännös (Vercel → Deployments → Redeploy), koska muuttujat luetaan käynnistyksessä.

## 6. Tarkistus

1. **Yhteys:** aja omalla koneella eRapun hakemistossa. PowerShellissä muuttuja asetetaan omalla rivillään:
   ```powershell
   $env:ESINETTI_API_KEY = "sk_live_..."
   npm run esinetti:yhteystesti
   Remove-Item Env:ESINETTI_API_KEY
   ```
   Git Bashissa vastaava onnistuu yhdellä rivillä: `ESINETTI_API_KEY=sk_live_... npm run esinetti:yhteystesti`.

   Komento kutsuu vain lukevaa reittiä `/usage`, joten mitään ei synny eSinettiin. `HTTP 200` tarkoittaa, että avain ja osoite ovat kunnossa. Viimeinen rivi poistaa avaimen istunnosta, jottei se jää muistiin.
2. **Asetukset:** eRapun **Asetukset → Integraatiot** näyttää rivin eSinetti tilassa "Käytössä" ilman puuttuvia muuttujia.
3. **Koko ketju:** ota testiyhtiö, jolla on oikeat sähköpostiosoitteet.
   1. Luo kokous, merkitse se pidetyksi ja täytä päätökset.
   2. Anna puheenjohtajan ja vähintään yhden pöytäkirjantarkastajan nimi ja sähköposti.
   3. Paina **Lähetä allekirjoitettavaksi**. eRappu muodostaa pöytäkirjan PDF:n ja luo kierroksen eSinettiin.
   4. Allekirjoita sähköpostin linkistä pankkitunnuksilla.
   5. Kun viimeinen on allekirjoittanut, eSinetti sinetöi PDF:n ja kutsuu webhookia: kokouksen tilaksi tulee "pöytäkirja allekirjoitettu" ja sinetöity PDF ilmestyy yhtiön dokumentteihin.
   6. Varmista vielä, että sinetöity PDF löytyy eSinetin julkisesta tarkistuksesta tiivisteellään.

Jos webhook ei tule perille, eSinetin toimitukset näkyvät sen omassa lokissa, ja eRapun vastaus kertoo syyn: `503` = salaisuus puuttuu eRapusta, `401` = salaisuus on eri kuin eSinetissä.

## Mitä kannattaa tietää

- **Vahva tunnistus** on oletus jokaisella allekirjoittajalla (pankkitunnukset tai mobiilivarmenne). Kevyt sähköpostivahvistus on olemassa, mutta eRappu ei käytä sitä pöytäkirjoissa.
- **Muistutukset** lähtevät automaattisesti 3 ja 7 päivän kuluttua, ja kierros vanhenee 30 päivässä.
- **Kutsuraja** on 60 pyyntöä minuutissa per avain.
- **Kahdentumisen esto:** eSinetissä ei ole `Idempotency-Key`-tukea, joten eRappu tarkistaa ulkoisella viitteellä (`erappu:meeting:<id>`), onko kierros jo olemassa, ennen kuin luo uuden. Katkennut yhteys ei siis lähetä samaa pöytäkirjaa kahdesti.
- **Yhtiöt:** eRappu ei toistaiseksi kerro eSinetille, mistä taloyhtiöstä on kyse, joten kaikki kierrokset menevät eSinetissä organisaation oletusyhtiölle. Arkistointi yhtiöittäin vaatisi taloyhtiöiden kytkemisen eSinetin yhtiöihin (`POST /companies`).
- **Hinnoittelu** perustuu vahvojen tunnistusten määrään. Kulutuksen näkee eSinetin omalta sivulta ja rajapinnasta `/usage`.
