# HTJ2: mitä MML:n dokumentaatio edellyttää eRapulta

Maanmittauslaitoksen HTJ2-dokumentaatio saatiin 23.9.2026 (OneDrive-paketti, 17 tiedostoa).
Tiedostot ovat `data/private/htj/htj2/` (gitignore), koska ne on merkitty
kehityskumppanien käyttöön eikä niitä saa julkaista. Tämä muistio on oma yhteenveto
siitä, mitä niistä seuraa eRapun toteutukselle; yksityiskohdat luetaan aina
alkuperäisistä dokumenteista.

Paketin sisältö: HTJ:n yleiskuvaus, hajautetun käytön hallinta (järjestelmälupa,
optimistinen lukitus, muutostietopalvelu), taloyhtiön erikoistilanteet, tietojen
vahvistamisen konsepti, tietopalvelut-konsepti, koeympäristön testitapaukset sekä
validointisäännöt kahtena Excel-tiedostona.

## 1. Järjestelmälupa korvaa valtuutusavaimen

HTJ1:ssä käytetty valtuutusavain perustuu avaimen hallussapitoon. HTJ2:ssa
hallinnollisten tietojen käyttö perustuu kahteen asiaan:

1. **Järjestelmälupa.** Isännöinti antaa luvan sille järjestelmälle, jolla se käsittelee
   taloyhtiöiden tietoja. Lupa tehdään MML:n sähköisessä asioinnissa, johon järjestelmä
   ohjaa käyttäjän. Käyttäjä hyväksyy käyttöehdot ja palaa takaisin järjestelmään.
2. **Käyttöoikeus taloyhtiön tietoihin.** Se tulee kaupparekisterin asemavaltuudesta
   (isännöitsijäksi merkitty henkilö tai isännöintiyhteisö) tai erikseen annetusta
   suomi.fi-valtuudesta "taloyhtiön tietojen hallinnointi".

   **Adeptan tilanne (Jukka 23.9.2026):** Jukka Taskinen on merkitty kaupparekisteriin
   henkilöisännöitsijäksi hoitamiinsa taloyhtiöihin, joten käyttöoikeus syntyy suoraan
   asemavaltuudesta eikä taloyhtiöiltä tarvita erillisiä suomi.fi-valtuuksia. Isännöintitaho
   on siis henkilö, ei isännöintiyhteisö. Jukalla on nimenkirjoitusoikeus, jolla hän voi
   antaa tarvittavat valtuudet palveluihin. Avoin kysymys MML:lle: mitä tunnistetta
   henkilöisännöitsijästä käytetään rajapintakutsuissa. Jos se on henkilötunnus, se
   tallennetaan eRapussa kenttäsalattuna eikä sitä kirjoiteta lokeihin, osoitteisiin eikä
   gitiin (CLAUDE.md:n sääntö).

Luvan edellytys on, että järjestelmä on MML:n sertifioitujen, huoneistotietojärjestelmään
integroituvien järjestelmien luettelossa. Se edellyttää sopimusta MML:n kanssa ja
hyväksyttyä testiraporttia koeympäristöstä (luku 3).

### Vahva vai heikko tunnistautuminen

| | Vahva tunnistautuminen (tavoitetila) | Heikko tunnistautuminen (toistaiseksi) |
|---|---|---|
| Kirjautuminen | Pankkitunnus, mobiilivarmenne tai henkilökortti (laki 617/2009) | Esim. käyttäjätunnus ja salasana |
| Järjestelmälupa | Jokainen käyttäjä tekee oman lupansa | Isännöintitaho (isännöitsijä tai isännöintiyhteisö) tekee luvan |
| Rajapintakutsun identiteetti | Tunnistettu käyttäjä | Isännöintitahon tunniste |
| Voimassaolo | Toistaiseksi, käyttöehtojen muuttuessa uusittava; käyttämätön lupa vanhenee (alustavasti 18 kk) | Määräaikainen |

eRapun henkilökunnan kirjautuminen on Auth0:n salasana ja todennussovellus, mikä ei ole
lain tarkoittamaa vahvaa tunnistautumista. eRappu aloittaa siis heikon tunnistautumisen
menettelyllä: kutsut tehdään isännöintitahon (Adepta) tunnisteella ja valtuuksilla.
Vahvaan tunnistautumiseen siirtyminen edellyttäisi vahvaa tunnistusta kirjautumiseen –
sama kysymys kuin eSinetin Telia Tunnistuksen käytössä (BLOCKERS 6).

### Mitä eRapun pitää toteuttaa

- Toiminto "Huoneistotietojärjestelmän järjestelmälupa", joka kertoo luvan tilan ja ohjaa
  käyttäjän MML:n asiointiin lupaa tekemään sekä palaa takaisin.
- Isännöintitahon tunnisteen valinta ja tallennus: millä tunnisteella kunkin yhtiön
  kutsut tehdään. Yhdellä isännöintitaholla on oikeus yhden tai useamman yhtiön tietoihin.
- Luvan voimassaolon seuranta: HTJ palauttaa voimassaoloajan jokaisen kutsun yhteydessä,
  ja käyttäjää on huomautettava ennen vanhenemista.
- Valtuuksien puuttuminen on näytettävä selkeästi: yhtiön tietoja ei saa haettua, jos
  valtuutta ei ole.

## 2. Optimistinen lukitus

Päivitettävillä tiedoilla on versionumero, joka tulee mukana haussa ja lisäyksen
vastauksessa. Päivitys ja poisto on tehtävä versionumerolla; jos joku muu on päivittänyt
välissä, HTJ vastaa virheellä (400 tai 409). Lukitus koskee kokonaisuutta, ei yksittäistä
toimenpidettä:

- yksi kunnossapito- ja muutostyöhanke
- yhden vuoden kunnossapitotarveselvitys
- luoton yhtiökohtaiset tiedot (lainaosuuksiin jakaminen)
- yhtiölaina osakeryhmäkohtaisine lainaosuuksineen
- yhtiön vastike perustietoineen ja osakeryhmäkohtaisine tietoineen

Seuraukset eRapulle: versionumero on tallennettava jokaiselle edellä mainitulle
kokonaisuudelle, tiedot on haettava HTJ:stä ennen muokkausta ja konfliktitilanteessa
käyttäjälle on näytettävä sekä oma että HTJ:n versio ja annettava valita, kumpi jää
voimaan. Luotonantajien ilmoittamat luotot eivät ole lukituksen piirissä: uusi ilmoitus
korvaa aina edelliset.

## 3. Koeympäristön testitapaukset ennen tuotantolupaa

MML pyytää vapaamuotoisen testiraportin koeympäristössä ajetuista testeistä. Testit on
ajettava järjestelmäluvan kanssa. Vaaditut testitapaukset:

- **Järjestelmälupa:** luonti, aktivointi, poisto, käyttäminen.
- **KUMU (kunnossapito- ja muutostyöt):** hanketietojen tuonti, haku (yhtiön hankkeet,
  osakasremontit, yksittäinen hanke tunnisteella, koodistopuun voimassa olevat arvot),
  päivitys ja poisto.
- **KPTS:** tietojen tuonti, haku (laatimisvuoden mukaan, viimeisimmät laajoilla
  tiedoilla, koodistopuu), päivitys ja poisto.
- **Koodistot:** kategorioiden haku, kaikkien koodistojen haku, haku koodistopuun
  tunnuksella, haku kategorian perusteella.
- **Taloudelliset tiedot:** yhtiön lainavastuiden haku ja yksittäinen lainavastuu,
  vastuiden tallennus ja päivitys osakeryhmittäin, vastuiden poisto; vastikkeiden haku,
  yksittäinen vastike, tallennus, päivitys ja poisto; luottojen jyvitystietojen haku ja
  tallennus; yhtiölle myönnettyjen luottojen listaus.
- Lisäksi sivutettujen hakujen testaus eri sivuilla ja sivukoolla.

Tämä on samalla eRapun HTJ2-toteutuksen laajuus: KUMU, KPTS, koodistot ja taloudelliset
tiedot. eRapussa on jo ilmoitusjono näille (M2), mutta se lähettää jäljitelmälle.

## 4. Työjärjestys

1. Koeympäristön yhteys toimimaan: järjestelmälupa koeympäristöön (nyt 403).
2. Koodistorajapinta ensin, koska KUMU ja KPTS käyttävät koodistoja.
3. KPTS ja KUMU: tuonti, haku, päivitys, poisto ja versionumerot.
4. Taloudelliset tiedot: lainat, vastikkeet ja luottojen jyvitys.
5. Sivutus ja validointisäännöt (kaksi Excel-tiedostoa) läpi.
6. Testiraportti MML:lle, sopimus ja sertifiointi, sitten tuotantolupa.

## 5. Mitä Jukan pitää tehdä

- Sopimus MML:n kanssa eRapun lisäämisestä integroituvien järjestelmien luetteloon
  (Adepta Tilat Oy järjestelmätoimittajana).
- Järjestelmälupa koeympäristöön, jotta kehitys pääsee eteenpäin.
- Valtuudet ovat kunnossa: Jukka on kaupparekisterissä henkilöisännöitsijänä, joten
  asemavaltuus riittää eikä taloyhtiöiltä tarvita suomi.fi-valtuuksia. Tarkistettava vielä,
  koskeeko tämä kaikkia 11 yhtiötä, ja mitä tunnistetta kutsuissa käytetään.
