/**
 * erappu.fi:n markkinointisivujen sisältö yhdessä paikassa (Jukka 22.9.2026).
 *
 * Linja: myydään helppoutta ja vaivattomuutta. Jokainen väite vastaa
 * toimintoa, joka eRapussa oikeasti on: ei lupauksia tulevista
 * ominaisuuksista eikä keksittyjä lukuja. Hinnat puuttuvat tarkoituksella,
 * kunnes Jukka päättää hinnoittelun.
 */

export const CONTACT = {
  company: "Adepta Tilat Oy",
  /** Tarkistettava ennen julkaisua: minne esittelypyynnöt ohjataan. */
  email: "jukka.taskinen@adepta.fi",
  person: "Jukka Taskinen",
};

export interface Feature {
  title: string;
  body: string;
}

/** Isännöitsijän arki: mitä eRappu tekee puolestasi. */
export const MANAGER_FEATURES: Feature[] = [
  {
    title: "Kokoukset valmiina minuuteissa",
    body: "Kokouskutsu, esityslista ja pöytäkirja syntyvät yhtiön tiedoista. Pykälän liitteet tulevat mukaan numeroituina, ja pöytäkirja lähtee allekirjoitettavaksi pankkitunnuksilla.",
  },
  {
    title: "Isännöitsijäntodistus ilman kokoamista",
    body: "Todistus muodostuu rekisteristä: osakkeet, vastikkeet, lainaosuudet, korjaushistoria ja yhtiön lainat. Liitteet kootaan samaan PDF:ään, ja valmis todistus sinetöidään sähköisesti.",
  },
  {
    title: "Vuosikello muistaa puolestasi",
    body: "Tilinpäätös, yhtiökokous, pelastussuunnitelman tarkistus, palovaroittimet ja HTJ-ilmoitukset tulevat tehtäviksi oikeaan aikaan jokaiselle yhtiölle.",
  },
  {
    title: "HTJ-tiedot koottuna",
    body: "Kunnossapito-, muutostyö- ja lainatiedot ovat samassa paikassa, josta ne ilmoitetaan huoneistotietojärjestelmään.",
  },
  {
    title: "Pelastussuunnitelma ja muutostyöohje pohjasta",
    body: "Rekisterin tiedoilla esitäytetty pelastussuunnitelma ja yhtiön oma muutostyöohje. Lakiin perustuvat vakiotekstit ovat valmiina, ja sinä täydennät vain yhtiön omat tiedot.",
  },
  {
    title: "Vesilaskutus ilman taulukoita",
    body: "Mittarilukemat asukkailta portaalin kautta, kuva mittarista mukaan. Vesiennakot ja tasauslaskut lasketaan lukemista.",
  },
];

/** Hallitukselle ja osakkaille: mitä he näkevät. */
export const RESIDENT_FEATURES: Feature[] = [
  {
    title: "Huoltopyyntö puhelimella",
    body: "Asukas kuvaa vian ja lähettää pyynnön. Tila näkyy koko ajan, eikä kenenkään tarvitse soitella perään.",
  },
  {
    title: "Tiedotteet ja asiakirjat yhdessä paikassa",
    body: "Yhtiöjärjestys, pöytäkirjat, pelastussuunnitelma ja tiedotteet löytyvät portaalista silloin, kun niitä tarvitaan.",
  },
  {
    title: "Kuka korjaa mitä",
    body: "Vastuunjakotaulukko kuvina: napauta kohdetta, niin näet, kuuluuko korjaus yhtiölle vai osakkaalle ja miksi.",
  },
  {
    title: "Muutostyöilmoitus lomakkeella",
    body: "Remonttia suunnitteleva osakas ilmoittaa työstä portaalissa ja saa yhtiön ehdot kirjallisena.",
  },
  {
    title: "Hallitus näkee saman kuin isännöitsijä",
    body: "Kokousten asialistat liitteineen, vuosikello ja yhtiön tehtävät ovat hallituksen nähtävillä. Kokouksessa liitteen voi avata pykälän kohdalta.",
  },
  {
    title: "Tilojen varaukset",
    body: "Sauna, pesutupa tai kerhohuone varataan kalenterista. Päällekkäisiä varauksia ei synny.",
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ: FaqItem[] = [
  {
    question: "Kenelle eRappu on tarkoitettu?",
    answer: "Isännöintitoimistoille ja niiden hallinnoimille taloyhtiöille. Isännöitsijä hoitaa yhtiöt eRapussa, ja hallitus, osakkaat ja asukkaat käyttävät samaa palvelua portaalin kautta.",
  },
  {
    question: "Tarvitaanko asennuksia tai ohjelmia?",
    answer: "Ei. eRappu toimii selaimessa tietokoneella ja puhelimella. Asukas kirjautuu sähköpostiin tulevalla koodilla, joten salasanoja ei tarvitse muistaa.",
  },
  {
    question: "Miten allekirjoitukset toimivat?",
    answer: "Pöytäkirjat ja sopimukset allekirjoitetaan pankkitunnuksilla eSinetti-palvelussa. Allekirjoittaja saa linkin sähköpostiin, eikä hänen tarvitse rekisteröityä mihinkään. Allekirjoitettu asiakirja tallentuu yhtiön asiakirjoihin itsestään.",
  },
  {
    question: "Kuka päättää, kuka allekirjoittaa pöytäkirjan?",
    answer: "Yhtiöjärjestys. eRapussa kirjataan jokaiselle yhtiölle sen oma sääntö, esimerkiksi kaikki läsnä olleet tai puheenjohtaja ja valittu jäsen, ja allekirjoittajat valitaan sen mukaan.",
  },
  {
    question: "Missä tiedot ovat?",
    answer: "EU:ssa. Henkilötunnuksia ei tallenneta selväkielisinä, ja jokainen muutos kirjautuu tapahtumalokiin.",
  },
  {
    question: "Voiko nykyiset tiedot tuoda mukaan?",
    answer: "Voi. Taloyhtiöt, osakeluettelo, lainat ja asiakirjat siirretään käyttöönoton yhteydessä, joten aloitat valmiista rekisteristä etkä tyhjästä.",
  },
];

export const FEATURE_PAGE_SECTIONS = [
  { id: "isannoitsijalle", title: "Isännöitsijälle", lead: "Toistuvat työt hoituvat yhtiön tiedoista. Sinä tarkistat ja hyväksyt.", items: MANAGER_FEATURES },
  { id: "taloyhtiolle", title: "Hallitukselle, osakkaille ja asukkaille", lead: "Sama palvelu, oma näkymä. Kaikki löytyy puhelimesta.", items: RESIDENT_FEATURES },
] as const;
