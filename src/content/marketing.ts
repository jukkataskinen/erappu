/**
 * erappu.fi:n markkinointisivujen sisältö yhdessä paikassa.
 *
 * Kohderyhmä ja järjestys (Jukka 23.9.2026, toteutusehdotus): ostaja on
 * taloyhtiö ja päättäjä hallitus, joten etusivu etenee ongelmasta hallituksen
 * hyötyyn, käyttötapaukseen, hintaan ja luottamukseen. Isännöitsijä on
 * myyntikanava ja päivittäinen käyttäjä, joten hänellä on oma sivunsa.
 *
 * Jokainen väite vastaa toimintoa, joka eRapussa oikeasti on. Lupauksia
 * tukipalvelusta tai varmuuskopioista ei kirjoiteta ennen kuin Jukka on
 * päättänyt ne.
 */

export const CONTACT = {
  company: "Adepta Oy",
  /** Tarkistettava ennen julkaisua: minne esittelypyynnöt ohjataan. */
  email: "jukka.taskinen@adepta.fi",
  person: "Jukka Taskinen",
};

export const TAGLINE = "Selkeää ja läpinäkyvää isännöintiä.";

export interface Feature {
  title: string;
  body: string;
}

/** Ongelma, jonka hallitus tunnistaa omasta arjestaan. */
export const PROBLEMS: Feature[] = [
  { title: "Tieto on monessa paikassa", body: "Pöytäkirjat sähköpostissa, tarjoukset liitteinä, huoneistotiedot Excelissä ja sopimukset mapissa." },
  { title: "Asiat unohtuvat", body: "Kunnossapitotarveselvitys, pelastussuunnitelman tarkistus ja ilmoitukset huoneistotietojärjestelmään muistetaan vasta, kun joku kysyy." },
  { title: "Samat kysymykset toistuvat", body: "Osakas soittaa hallituksen jäsenelle, koska ei tiedä, kuka korjaa mitä ja mitä kokouksessa päätettiin." },
  { title: "Allekirjoitukset kiertävät paperilla", body: "Pöytäkirja odottaa allekirjoittajia viikkoja, ja alkuperäinen kappale on yhdellä ihmisellä." },
];

/** Mitä hallitus saa. Nämä ovat sivuston tärkein osa. */
export const BOARD_BENEFITS: Feature[] = [
  { title: "Tieto löytyy", body: "Yhtiöjärjestys, pöytäkirjat, tilinpäätökset, sopimukset ja huoneistotiedot ovat samassa paikassa, ja jokainen hallituksen jäsen pääsee niihin itse." },
  { title: "Asiat eivät unohdu", body: "Vuosikello näyttää, mitä yhtiössä pitää tehdä ja milloin. Hallitus näkee, mikä on tehty ja mikä on myöhässä." },
  { title: "Päätökset pysyvät tallessa", body: "Kokouksen asialista, liitteet ja päätökset kirjataan samaan paikkaan, ja pöytäkirja allekirjoitetaan pankkitunnuksilla." },
  { title: "Vähemmän yhteydenottoja", body: "Osakkaat ja asukkaat näkevät tiedotteet, asiakirjat ja vastuunjaon portaalista, joten hallitukselle jää vähemmän selvittelyä." },
  { title: "Velvoitteet hoituvat ajallaan", body: "Kunnossapitotarveselvitys, pelastussuunnitelma, palovaroittimet ja huoneistotietojärjestelmän ilmoitukset ovat tehtävälistalla määräpäivineen." },
  { title: "Näet mitä yhtiössä tapahtuu", body: "Huoltopyynnöt, korjaukset, muutostyöilmoitukset ja talouden tilanne ovat hallituksen nähtävillä ilman erillistä kyselyä." },
];

export const BEFORE = [
  "Pöytäkirjat sähköpostin liitteinä",
  "Huoneistotiedot Excelissä",
  "Tarjoukset ja sopimukset mapissa",
  "Allekirjoitukset postissa",
  "Asukkaiden soitot hallitukselle",
];

export const AFTER = [
  "Päätökset ja pöytäkirjat yhdessä paikassa",
  "Huoneisto- ja osaketiedot ajan tasalla",
  "Asiakirjat haettavissa milloin vain",
  "Allekirjoitukset pankkitunnuksilla",
  "Asukkaat löytävät tiedot itse",
];

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
  { title: "Huoltopyyntö puhelimella", body: "Asukas kuvaa vian ja lähettää pyynnön. Tila näkyy koko ajan, eikä kenenkään tarvitse soitella perään." },
  { title: "Tiedotteet ja asiakirjat yhdessä paikassa", body: "Yhtiöjärjestys, pöytäkirjat, pelastussuunnitelma ja tiedotteet löytyvät portaalista silloin, kun niitä tarvitaan." },
  { title: "Kuka korjaa mitä", body: "Vastuunjakotaulukko kuvina: napauta kohdetta, niin näet, kuuluuko korjaus yhtiölle vai osakkaalle ja miksi." },
  { title: "Muutostyöilmoitus lomakkeella", body: "Remonttia suunnitteleva osakas ilmoittaa työstä portaalissa ja saa yhtiön ehdot kirjallisena." },
  { title: "Hallitus näkee saman kuin isännöitsijä", body: "Kokousten asialistat liitteineen, vuosikello ja yhtiön tehtävät ovat hallituksen nähtävillä. Kokouksessa liitteen voi avata pykälän kohdalta." },
  { title: "Tilojen varaukset", body: "Sauna, pesutupa tai kerhohuone varataan kalenterista. Päällekkäisiä varauksia ei synny." },
];

/**
 * Vertailukohtia hinnalle (Jukka 23.9.2026): mitä samat asiat maksavat
 * erikseen ostettuina. Luvut ovat suuntaa antavia ja arvonlisäverottomia
 * kuten eRapun hinnat.
 */
export interface ComparisonRow {
  label: string;
  price: string;
  note: string;
}

export const COST_COMPARISON: ComparisonRow[] = [
  {
    label: "Vastuunjakotaulukko verkkoversiona",
    price: "150 € / vuosi",
    note: "eRapussa taulukko kuuluu palveluun, ja yhtiön omat poikkeukset merkitään siihen.",
  },
  {
    label: "Pelastussuunnitelman ylläpito ja nähtävilläolo",
    price: "100 € / vuosi",
    note: "eRapussa suunnitelma tehdään yhtiön omista tiedoista ja näkyy asukkaille portaalissa.",
  },
  {
    label: "Kokouskutsut ja tiedotteet paperilla, 10 osakasta",
    price: "30–50 € / vuosi",
    note: "Postimerkit ja kopiot. eRapussa kutsut ja tiedotteet lähtevät sähköpostilla.",
  },
];

/** Luottamus: vain se, mikä on totta ja tarkistettavissa. */
export const TRUST: Feature[] = [
  { title: "Suomalainen palvelu, tiedot EU:ssa", body: "Palvelu, tietokanta ja asiakirjat ovat EU:n alueella. Taloyhtiön tiedot ovat taloyhtiön omia." },
  { title: "Henkilötiedot suojattu", body: "Henkilötunnuksia ei tallenneta selväkielisinä, ja arkaluonteiset kentät salataan. Portaaliin kirjaudutaan sähköpostiin tulevalla kertakoodilla." },
  { title: "Jokainen muutos kirjataan", body: "Tapahtumaloki kertoo, kuka muutti mitä ja milloin. Allekirjoitusten muutokset kirjataan erikseen." },
  { title: "Oikeudet roolin mukaan", body: "Isännöitsijä, kirjanpitäjä, hallitus, osakas ja asukas näkevät vain sen, mikä heille kuuluu." },
  { title: "Allekirjoitukset vahvalla tunnistuksella", body: "Pöytäkirjat ja sopimukset allekirjoitetaan pankkitunnuksilla, ja asiakirja sinetöidään muuttumattomaksi." },
  { title: "Tiedot ovat aina saatavilla", body: "Asiakirjat voi ladata itselleen PDF:nä, eikä palvelu ole ainoa paikka, jossa taloyhtiön aineisto on." },
];

export interface FaqItem {
  question: string;
  answer: string;
}

/** Oston esteet: hallituksen jäsenen kysymykset ennen päätöstä. */
export const BUYING_FAQ: FaqItem[] = [
  {
    question: "Kuka maksaa eRapun?",
    answer: "Taloyhtiö. Hinta on taloyhtiökohtainen, ja lasku menee suoraan yhtiölle. Päätös tehdään yhtiössä, ei isännöintitoimistossa.",
  },
  {
    question: "Kuka ylläpitää tietoja?",
    answer: "Isännöitsijä. Hän hoitaa yhtiön asiat eRapussa kuten tähänkin asti, ja hallitus saa saman tiedon näkyviinsä. Hallitukselta ei siirry töitä.",
  },
  {
    question: "Pitääkö hallituksen opetella uusi järjestelmä?",
    answer: "Ei. Hallituksen jäsen kirjautuu sähköpostiin tulevalla koodilla ja näkee kokoukset, asiakirjat ja tehtävät. Mitään ei tarvitse asentaa.",
  },
  {
    question: "Miten käyttöönotto tapahtuu?",
    answer: "Isännöitsijä siirtää yhtiön tiedot eRappuun: osakeluettelon, yhtiöjärjestyksen, lainat ja asiakirjat. Hallitus ja osakkaat saavat kutsun portaaliin, kun tiedot ovat valmiina.",
  },
  {
    question: "Voiko palvelun lopettaa?",
    answer: "Voi. Asiakirjat ja rekisteritiedot saa mukaan, eikä taloyhtiö menetä aineistoaan. Sopimuksen kesto ja irtisanomisaika sovitaan tarjouksessa.",
  },
  {
    question: "Missä tiedot säilytetään?",
    answer: "EU:n alueella. Sovellus ja tietokanta toimivat eurooppalaisilla palvelimilla, ja allekirjoitukset tehdään suomalaisessa eSinetti-palvelussa.",
  },
  {
    question: "Miten tietoturva on hoidettu?",
    answer: "Kirjautuminen on henkilökohtainen, oikeudet määräytyvät roolin mukaan ja jokainen muutos kirjataan tapahtumalokiin. Henkilötunnuksia ei tallenneta selväkielisinä.",
  },
];

export const FAQ: FaqItem[] = [
  {
    question: "Kenelle eRappu on tarkoitettu?",
    answer: "Taloyhtiöille ja niitä hoitaville isännöintitoimistoille. Isännöitsijä hoitaa yhtiön asiat eRapussa, ja hallitus, osakkaat ja asukkaat käyttävät samaa palvelua portaalin kautta.",
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
  ...BUYING_FAQ,
];

export const FEATURE_PAGE_SECTIONS = [
  { id: "isannoitsijalle", title: "Isännöitsijälle", lead: "Toistuvat työt hoituvat yhtiön tiedoista. Sinä tarkistat ja hyväksyt.", items: MANAGER_FEATURES },
  { id: "taloyhtiolle", title: "Hallitukselle, osakkaille ja asukkaille", lead: "Sama palvelu, oma näkymä. Kaikki löytyy puhelimesta.", items: RESIDENT_FEATURES },
] as const;
