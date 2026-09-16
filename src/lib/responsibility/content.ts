/**
 * Vastuunjakotaulukon vakiosisältö.
 *
 * Tulkinnat on kirjoitettu asunto-osakeyhtiölain (1599/2009) 4 luvun pohjalta
 * (Finlexin avoin data, ks. DECISIONS.md). Lain perussäännöt:
 *
 * - AOYL 4:1 § 1 mom: vastuu jaetaan 2 ja 3 §:n mukaan, jollei yhtiöjärjestyksessä
 *   määrätä toisin. Siksi jokainen tulkinta on yleinen ja yhtiöjärjestys voi kumota sen.
 * - AOYL 4:2 § 2 mom: yhtiö pitää kunnossa osakehuoneistojen rakenteet ja eristeet sekä
 *   lämmitys-, sähkö-, tiedonsiirto-, kaasu-, vesi-, viemäri-, ilmanvaihto- ja muut sen
 *   kaltaiset perusjärjestelmät. Yhtiö ei kuitenkaan vastaa osakehuoneistoissa olevista
 *   altaista. Yhtiö korjaa ne sisäosat, jotka vahingoittuvat rakenteen tai yhtiön
 *   vastuulle kuuluvan osan vian tai sen korjaamisen vuoksi.
 * - AOYL 4:2 § 3 mom: vastuu koskee vain sitä, minkä yhtiö on toteuttanut tai hyväksynyt
 *   vastuulleen, ja sisäosat korjataan ajankohdan perustasoon yhtiössä.
 * - AOYL 4:2 § 4 mom: yhtiö pitää kunnossa rakennuksen ulkopinnan myös osakkeenomistajan
 *   hallinnassa olevan parvekkeen kohdalla.
 * - AOYL 4:3 §: osakkeenomistaja pitää kunnossa osakehuoneistonsa sisäosat, hoitaa
 *   huoneistoaan huolellisesti eikä vastaa tavanomaisesta kulumisesta.
 * - L 535/2026 (voimaan 1.10.2026): 4:2 § 2 mom nimeää ikkunat erikseen yhtiön vastuulle;
 *   4:3 § 3 mom osakkaan käyttämän yhtiön tilan tai alueen huolellinen hoito, kun
 *   hallintaoikeus ei perustu yhtiöjärjestykseen tai vuokrasopimukseen; 4:3 § 4 mom
 *   tiedot huoneiston käyttöoikeuden saaneesta; 4:8 § 2 mom ilmoitus tällaisen tilan viasta.
 * - AOYL 1:3 § 2 mom: parveke, jolle on kulkuyhteys vain huoneiston kautta, kuuluu
 *   osakehuoneistoon; yhtiöjärjestyksessä voidaan määrätä toisin.
 *
 * Tekstit ovat omia tiivistelmiä. Mitään valmista vastuunjakotaulukkoa ei ole kopioitu.
 */

/**
 * Tulkinnat ovat eRapun omia luonnoksia, kunnes Jukka on tarkistanut ne
 * (BLOCKERS 12). Henkilökunnan sivulla näkyy siihen asti huomautus.
 */
export const RESPONSIBILITY_CONTENT_APPROVED = false;

export const RESPONSIBILITIES = ["company", "shareholder", "shared"] as const;

export type Responsibility = (typeof RESPONSIBILITIES)[number];

export const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  company: "Yhtiö",
  shareholder: "Osakas",
  shared: "Jaettu",
};

/** Lauseeseen sopiva muoto: "Poikkeus: osakkaan vastuulla". */
export const RESPONSIBILITY_PHRASE: Record<Responsibility, string> = {
  company: "yhtiön vastuulla",
  shareholder: "osakkaan vastuulla",
  shared: "vastuu jaettu yhtiön ja osakkaan kesken",
};

/** Pidempi selite legendaan ja ruudunlukijalle. */
export const RESPONSIBILITY_DESCRIPTION: Record<Responsibility, string> = {
  company: "Taloyhtiö vastaa kunnossapidosta ja kustannuksista.",
  shareholder: "Osakas vastaa kunnossapidosta ja kustannuksista.",
  shared: "Vastuu jakautuu: osa kuuluu yhtiölle, osa osakkaalle.",
};

export type RoomKey = "keittio" | "kylpyhuone" | "ovet" | "ikkunat" | "sauna" | "olohuone" | "parveke" | "piha";

export interface Room {
  key: RoomKey;
  label: string;
  /** Näkyy välilehden alla: mitä kuva esittää ja mitä rajauksia tilaan liittyy. */
  intro: string;
}

export interface ResponsibilityItem {
  /** Uniikki kaikkien tilojen kesken; poikkeukset viittaavat tähän. */
  key: string;
  room: RoomKey;
  label: string;
  responsibility: Responsibility;
  /** Kenelle vastuu kuuluu ja miksi. Kaksi–kolme virkettä. */
  text: string;
  /** Pykälä, johon tulkinta perustuu. */
  law: string;
  /** Tavallisin poikkeus tai huomio. */
  note?: string;
  /** Pisteen paikka kuvassa, viewBox-yksiköissä (VIEW_BOX). */
  x: number;
  y: number;
}

/** Kaikilla huonekuvilla sama viewBox, jotta koordinaatit ovat vertailukelpoisia. */
export const VIEW_BOX = { width: 1000, height: 640 } as const;

export const ROOMS: Room[] = [
  { key: "keittio", label: "Keittiö", intro: "Keittiön kalusteet ovat huoneiston sisäosia, mutta vesi-, viemäri-, sähkö- ja ilmanvaihtojärjestelmä kuuluu yhtiölle myös huoneiston sisällä." },
  { key: "kylpyhuone", label: "Kylpyhuone", intro: "Märkätilassa raja kulkee rakenteen ja pinnan välissä: vedeneristys ja putkisto ovat yhtiön, pintamateriaalit ja altaat osakkaan." },
  { key: "ovet", label: "Ovet", intro: "Huoneiston ulko-ovi on rakennuksen osa, huoneiston sisäovet ovat sisäosia." },
  { key: "ikkunat", label: "Ikkunat", intro: "Laki nimeää ikkunat yhtiön vastuulle 1.10.2026 alkaen (aiemmin rakenteena). Osakkaalle jäävät sisäpuoliset pinnat ja itse hankitut varusteet." },
  { key: "sauna", label: "Sauna", intro: "Kuva esittää huoneistokohtaista saunaa. Yhtiön yhteisen saunan kaikesta kunnossapidosta vastaa yhtiö." },
  { key: "olohuone", label: "Olohuone", intro: "Asuinhuoneen pinnat ovat osakkaan, talotekniikan runko ja rasiat yhtiön." },
  { key: "parveke", label: "Parveke", intro: "Parveke kuuluu osakehuoneistoon, mutta rakenne ja rakennuksen ulkopinta ovat yhtiön vastuulla myös parvekkeen kohdalla." },
  { key: "piha", label: "Piha", intro: "Huoneistokohtainen piha-alue on osakkaan hallinnassa vain, jos yhtiöjärjestys niin määrää. Kunnossapito on silti pääosin yhtiön." },
];

const KEITTIO: ResponsibilityItem[] = [
  {
    key: "keittio-hana",
    room: "keittio",
    label: "Vesihana ja sulkuventtiili",
    responsibility: "company",
    text: "Yhtiö vastaa, koska hana ja sen sulkuventtiili ovat osa huoneiston vesijohtojärjestelmää, jonka yhtiö on toteuttanut. Yhtiön vastuu ulottuu perusjärjestelmiin myös huoneiston sisällä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Jos osakas on itse vaihtanut hanan, yhtiö vastaa vain, jos asennus rinnastuu yhtiön toteuttamaan ja yhtiö on voinut valvoa sen (AOYL 4:2 § 3 mom).",
    x: 250,
    y: 305,
  },
  {
    key: "keittio-viemari",
    room: "keittio",
    label: "Altaan viemäri ja hajulukko",
    responsibility: "shared",
    text: "Yhtiö vastaa viemärin kunnosta perusjärjestelmänä. Hajulukon puhdistaminen ja tukoksen avaaminen kuuluu asukkaan tavanomaiseen huolelliseen hoitoon.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 2 mom",
    note: "Jos tukos on aiheutunut huolimattomasta käytöstä, avaamisen kustannus voi jäädä osakkaalle.",
    x: 245,
    y: 500,
  },
  {
    key: "keittio-allas",
    room: "keittio",
    label: "Keittiöallas",
    responsibility: "shareholder",
    text: "Laissa on nimenomainen rajaus: yhtiö ei vastaa osakehuoneistoissa olevista altaista. Altaan uusiminen ja korjaus on siis osakkaan.",
    law: "AOYL 4:2 § 2 mom",
    note: "Jos allas rikkoutuu yhtiön vastuulla olevan vian tai korjaustyön takia, yhtiö korjaa vahingon perustasoon.",
    x: 170,
    y: 425,
  },
  {
    key: "keittio-tiskikone",
    room: "keittio",
    label: "Tiskikoneen liitäntä ja vuotokaukalo",
    responsibility: "shareholder",
    text: "Kone ja sen liitokset ovat osakkaan hankkimia eivätkä kuulu yhtiön toteuttamaan perusjärjestelmään. Osakas vastaa liitännästä, vuotokaukalosta ja niiden kunnosta.",
    law: "AOYL 4:2 § 3 mom ja 4:3 §",
    note: "Liitännästä on tehtävä kirjallinen ilmoitus yhtiölle ennen työtä, koska se voi vaikuttaa yhtiön vastuulla olevaan putkistoon (AOYL 4:7 §).",
    x: 415,
    y: 465,
  },
  {
    key: "keittio-liesi",
    room: "keittio",
    label: "Liesi",
    responsibility: "shareholder",
    text: "Liesi on huoneiston laite eikä yhtiön perusjärjestelmä, joten se kuuluu osakkaan kunnossapitovastuulle sisäosana.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos yhtiö on hankkinut liedet ja hyväksynyt ne vastuulleen, vastuu on yhtiön (AOYL 4:2 § 3 mom).",
    x: 560,
    y: 462,
  },
  {
    key: "keittio-liesituuletin",
    room: "keittio",
    label: "Liesituuletin ja liesikupu",
    responsibility: "shared",
    text: "Jos kupu on liitetty yhtiön koneelliseen poistoilmanvaihtoon, se on osa ilmanvaihtojärjestelmää ja yhtiön vastuulla. Osakkaan itse hankkima tuuletin, esimerkiksi aktiivihiilimalli, on osakkaan.",
    law: "AOYL 4:2 § 2 ja 3 mom",
    note: "Rasvasuodattimen pesu ja vaihto on asukkaan tavanomaista hoitoa.",
    x: 530,
    y: 180,
  },
  {
    key: "keittio-iv-venttiili",
    room: "keittio",
    label: "Ilmanvaihdon venttiili",
    responsibility: "company",
    text: "Venttiili on osa yhtiön ilmanvaihtojärjestelmää, joten yhtiö vastaa sen kunnosta ja säädöstä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Asukas puhdistaa venttiilin pinnan, mutta ei saa muuttaa säätöä: säätö on osa koko rakennuksen ilmanvaihdon tasapainoa.",
    x: 765,
    y: 60,
  },
  {
    key: "keittio-kaapistot",
    room: "keittio",
    label: "Kaapistot ja työtaso",
    responsibility: "shareholder",
    text: "Kalusteet ja työtaso ovat huoneiston sisäosia, joten osakas vastaa niiden kunnosta ja uusimisesta.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos kalusteet vahingoittuvat rakenteen tai yhtiön vastuulla olevan osan vian tai korjaamisen vuoksi, yhtiö korjaa ne yhtiön senhetkiseen perustasoon (AOYL 4:2 § 2 ja 3 mom).",
    x: 150,
    y: 175,
  },
  {
    key: "keittio-pistorasiat",
    room: "keittio",
    label: "Pistorasiat ja sähköjohdot",
    responsibility: "company",
    text: "Sähköjärjestelmä on yhtiön perusjärjestelmä myös huoneiston sisällä, joten rasiat ja kiinteät johdot ovat yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan itse teettämät lisärasiat jäävät osakkaalle, jollei yhtiö ole hyväksynyt niitä vastuulleen (AOYL 4:2 § 3 mom).",
    x: 690,
    y: 320,
  },
  {
    key: "keittio-runkoputki",
    room: "keittio",
    label: "Vesijohdon runkoputki ja putkikotelo",
    responsibility: "company",
    text: "Runkoputki on rakennuksen vesijohtojärjestelmää ja kotelo rakenne, joten molemmat ovat yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan on ilmoitettava yhtiölle viivytyksettä havaitsemastaan vuodosta tai kosteudesta (AOYL 4:8 §).",
    x: 955,
    y: 240,
  },
];

const KYLPYHUONE: ResponsibilityItem[] = [
  {
    key: "kylpyhuone-vedeneristys",
    room: "kylpyhuone",
    label: "Vedeneristys",
    responsibility: "company",
    text: "Vedeneristys on rakenteen eriste, ja yhtiö pitää kunnossa osakehuoneistojen rakenteet ja eristeet.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan teettämässä remontissa yhtiö vastaa eristyksestä vain, jos työ rinnastuu yhtiön toteuttamaan ja yhtiö on voinut valvoa sen. Siksi kylpyhuoneremontista on tehtävä ilmoitus etukäteen (AOYL 4:2 § 3 mom, 4:7 § ja 4:9 §).",
    x: 480,
    y: 528,
  },
  {
    key: "kylpyhuone-lattiakaivo",
    room: "kylpyhuone",
    label: "Lattiakaivo ja korokerengas",
    responsibility: "shared",
    text: "Kaivo ja korokerengas liittyvät viemärijärjestelmään ja vedeneristykseen, joten yhtiö vastaa niiden kunnosta. Kaivon puhdistus on asukkaan tavanomaista hoitoa.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 2 mom",
    x: 200,
    y: 565,
  },
  {
    key: "kylpyhuone-laatoitus",
    room: "kylpyhuone",
    label: "Laatoitus ja pinnat",
    responsibility: "shareholder",
    text: "Laatat, saumat ja muut pintamateriaalit ovat huoneiston sisäosia, joten osakas vastaa niistä.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos pinta joudutaan purkamaan yhtiön vastuulla olevan vian tai sen korjaamisen takia, yhtiö palauttaa pinnan perustasoon (AOYL 4:2 § 2 ja 3 mom).",
    x: 940,
    y: 200,
  },
  {
    key: "kylpyhuone-wc",
    room: "kylpyhuone",
    label: "WC-istuin",
    responsibility: "company",
    text: "Istuin on kiinteä osa vesi- ja viemärijärjestelmää, joten se on tavanomaisesti yhtiön vastuulla. Laissa oleva altaita koskeva rajaus tarkoittaa pesualtaita, ei wc-istuinta.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan itse vaihtama istuin jää osakkaalle, jollei yhtiö ole hyväksynyt sitä vastuulleen. Istuimen irtoavat osat, kuten kansi, ovat asukkaan.",
    x: 690,
    y: 330,
  },
  {
    key: "kylpyhuone-pesuallas",
    room: "kylpyhuone",
    label: "Pesuallas ja hana",
    responsibility: "shared",
    text: "Laki rajaa altaat nimenomaisesti yhtiön vastuun ulkopuolelle, joten allas on osakkaan. Hana ja sen liitokset ovat vesijohtojärjestelmää ja siten yhtiön.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 1 mom",
    x: 460,
    y: 340,
  },
  {
    key: "kylpyhuone-suihku",
    room: "kylpyhuone",
    label: "Suihku ja sekoittaja",
    responsibility: "shared",
    text: "Sekoittaja on osa vesijohtojärjestelmää ja siten yhtiön. Suihkuletku, suihkukahva ja teline ovat kuluvia varusteita ja jäävät osakkaalle.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 1 mom",
    x: 150,
    y: 240,
  },
  {
    key: "kylpyhuone-pyykinpesukone",
    room: "kylpyhuone",
    label: "Pyykinpesukoneen liitäntä",
    responsibility: "shareholder",
    text: "Kone ja sen liitokset ovat osakkaan hankkimia, joten osakas vastaa liitännästä, letkuista ja niiden kunnosta.",
    law: "AOYL 4:2 § 3 mom ja 4:3 §",
    note: "Liitännästä on ilmoitettava yhtiölle etukäteen kirjallisesti (AOYL 4:7 §).",
    x: 800,
    y: 300,
  },
  {
    key: "kylpyhuone-lattialammitys",
    room: "kylpyhuone",
    label: "Lattialämmitys",
    responsibility: "company",
    text: "Yhtiön toteuttama lattialämmitys on osa lämmitysjärjestelmää ja siten yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan jälkikäteen asentama sähköinen lattialämmitys jää osakkaalle, jollei yhtiö ole hyväksynyt sitä vastuulleen (AOYL 4:2 § 3 mom).",
    x: 780,
    y: 575,
  },
  {
    key: "kylpyhuone-iv-venttiili",
    room: "kylpyhuone",
    label: "Poistoilmaventtiili",
    responsibility: "company",
    text: "Venttiili kuuluu yhtiön ilmanvaihtojärjestelmään, joten yhtiö vastaa sen kunnosta ja säädöstä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Asukas puhdistaa venttiilin pinnan eikä muuta säätöä.",
    x: 600,
    y: 70,
  },
  {
    key: "kylpyhuone-peilikaappi",
    room: "kylpyhuone",
    label: "Peilikaappi ja valaisin",
    responsibility: "shareholder",
    text: "Peilikaappi on kaluste ja siten huoneiston sisäosa. Osakas vastaa myös kaapin omasta valaisimesta ja lampuista.",
    law: "AOYL 4:3 § 1 mom",
    note: "Kaapin taakse jäävä kiinteä sähkörasia ja johto ovat yhtiön sähköjärjestelmää (AOYL 4:2 § 2 mom).",
    x: 460,
    y: 160,
  },
];

const OVET: ResponsibilityItem[] = [
  {
    key: "ovet-ulko-ovi",
    room: "ovet",
    label: "Huoneiston ulko-ovi ja karmi",
    responsibility: "shared",
    text: "Ovi ja karmi ovat rakennuksen osia, joten yhtiö vastaa niiden kunnosta ja porrashuoneen puoleisesta pinnasta. Oven huoneiston puoleinen pinta on sisäosa ja osakkaan.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 1 mom",
    note: "Palo-oven osia ei saa vaihtaa omin päin, koska ovi on osa rakennuksen paloturvallisuutta.",
    x: 110,
    y: 200,
  },
  {
    key: "ovet-lukko",
    room: "ovet",
    label: "Lukko ja sarjoitus",
    responsibility: "company",
    text: "Lukko on kiinteä osa ovea ja yhtiön lukitusjärjestelmää, joten yhtiö vastaa sen kunnossapidosta ja koko kiinteistön sarjoituksesta.",
    law: "AOYL 4:2 § 2 mom",
    note: "Avaimen katoamisesta johtuva uudelleensarjoitus ja osakkaan lisäämä varmuuslukko jäävät osakkaalle (AOYL 4:3 § 2 mom).",
    x: 400,
    y: 330,
  },
  {
    key: "ovet-ovisilma",
    room: "ovet",
    label: "Ovisilmä ja postiluukku",
    responsibility: "company",
    text: "Alkuperäinen ovisilmä ja postiluukku ovat oven kiinteitä osia, joten ne ovat yhtiön vastuulla kuten ovi itse.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan itse asentama ovisilmä, nimikilpi tai lisäluukku jää osakkaalle (AOYL 4:2 § 3 mom).",
    x: 270,
    y: 175,
  },
  {
    key: "ovet-ovensulkija",
    room: "ovet",
    label: "Ovensulkija",
    responsibility: "company",
    text: "Sulkija on oven kiinteä varuste ja liittyy porrashuoneen paloturvallisuuteen, joten yhtiö vastaa sen kunnosta ja säädöstä.",
    law: "AOYL 4:2 § 2 mom",
    x: 370,
    y: 105,
  },
  {
    key: "ovet-tiivisteet",
    room: "ovet",
    label: "Ulko-oven tiivisteet",
    responsibility: "company",
    text: "Tiivisteet ovat oven ja karmin kiinteitä osia, ja niiden kuluminen on tavanomaista kulumista, josta osakas ei vastaa. Yhtiö uusii tiivisteet.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 2 mom",
    note: "Asukkaan kannattaa ilmoittaa vedosta ja äänestä ajoissa (AOYL 4:8 §).",
    x: 110,
    y: 470,
  },
  {
    key: "ovet-sisaovet",
    room: "ovet",
    label: "Huoneiston sisäovet",
    responsibility: "shareholder",
    text: "Sisäovet, niiden karmit, helat ja pinnat ovat huoneiston sisäosia, joten osakas vastaa niistä.",
    law: "AOYL 4:3 § 1 mom",
    x: 750,
    y: 300,
  },
];

const IKKUNAT: ResponsibilityItem[] = [
  {
    key: "ikkunat-karmit",
    room: "ikkunat",
    label: "Karmit ja puitteet",
    responsibility: "company",
    text: "Yhtiö vastaa ikkunoiden kunnossapidosta ja uusimisesta. Laki mainitsee ikkunat erikseen yhtiön vastuulla oleviksi 1.10.2026 alkaen; sitä ennen ne kuuluivat yhtiölle rakenteena.",
    law: "AOYL 4:2 § 2 mom (ikkunat, muut. 535/2026)",
    x: 500,
    y: 80,
  },
  {
    key: "ikkunat-ulkopinnat",
    room: "ikkunat",
    label: "Ulkopuoliset pinnat ja maalaus",
    responsibility: "company",
    text: "Ikkunan ulkopinnat, vesipelti ja ulkopuolinen maalaus ovat rakennuksen ulkopintaa ja siten yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom (ikkunat, muut. 535/2026)",
    x: 836,
    y: 400,
  },
  {
    key: "ikkunat-sisapinnat",
    room: "ikkunat",
    label: "Sisäpuoliset pinnat ja maalaus",
    responsibility: "shareholder",
    text: "Sisäpuitteiden ja smyygien maalaus sekä ikkunalaudan pinta ovat huoneiston sisäosia, joten osakas vastaa niistä.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos ikkuna uusitaan yhtiön työnä, yhtiö palauttaa sisäpinnat perustasoon (AOYL 4:2 § 2 ja 3 mom).",
    x: 250,
    y: 450,
  },
  {
    key: "ikkunat-helat",
    room: "ikkunat",
    label: "Helat, saranat ja kääntökahva",
    responsibility: "company",
    text: "Helat ja saranat ovat ikkunan kiinteitä osia, joten yhtiö vastaa niiden kunnosta ja säädöstä.",
    law: "AOYL 4:2 § 2 mom (ikkunat, muut. 535/2026)",
    note: "Rikkoutuminen väärästä käytöstä voi jäädä osakkaan vastuulle (AOYL 4:3 § 2 mom).",
    x: 530,
    y: 300,
  },
  {
    key: "ikkunat-tiivisteet",
    room: "ikkunat",
    label: "Ikkunan tiivisteet",
    responsibility: "company",
    text: "Tiivisteet ovat ikkunan kiinteitä osia ja niiden kuluminen on tavanomaista kulumista, joten yhtiö uusii ne.",
    law: "AOYL 4:2 § 2 mom (ikkunat, muut. 535/2026) ja 4:3 § 2 mom",
    x: 680,
    y: 498,
  },
  {
    key: "ikkunat-lasit",
    room: "ikkunat",
    label: "Ikkunalasit",
    responsibility: "company",
    text: "Lasi on ikkunan eli rakenteen osa, joten yhtiö vastaa rikkoutuneen lasin uusimisesta.",
    law: "AOYL 4:2 § 2 mom (ikkunat, muut. 535/2026)",
    note: "Jos lasi rikkoutuu osakkaan tai asukkaan huolimattomuudesta, kustannus voi siirtyä vahingonkorvauksena osakkaalle (AOYL 4:3 § 2 mom ja 24 luku).",
    x: 700,
    y: 220,
  },
  {
    key: "ikkunat-salekaihtimet",
    room: "ikkunat",
    label: "Sälekaihtimet",
    responsibility: "shareholder",
    text: "Kaihtimet ovat huoneiston varusteita eivätkä rakennuksen rakennetta, joten osakas vastaa niistä.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos yhtiö on asentanut kaihtimet kaikkiin ikkunoihin ja hyväksynyt ne vastuulleen, vastuu on yhtiön (AOYL 4:2 § 3 mom).",
    x: 300,
    y: 140,
  },
];

const SAUNA: ResponsibilityItem[] = [
  {
    key: "sauna-kiuas",
    room: "sauna",
    label: "Kiuas",
    responsibility: "shareholder",
    text: "Kiuas on huoneiston laite eikä yhtiön perusjärjestelmä, joten huoneistokohtaisen saunan kiuas on osakkaan vastuulla.",
    law: "AOYL 4:3 § 1 mom",
    note: "Yhtiön hankkima ja vastuulleen hyväksymä kiuas on yhtiön (AOYL 4:2 § 3 mom). Yhtiön yhteisen saunan kiuas on aina yhtiön.",
    x: 210,
    y: 400,
  },
  {
    key: "sauna-lauteet",
    room: "sauna",
    label: "Lauteet ja panelointi",
    responsibility: "shareholder",
    text: "Lauteet ja paneloinnit ovat huoneiston sisäosia ja pintarakenteita, joten osakas vastaa niistä.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos paneeli puretaan yhtiön vastuulla olevan vian takia, yhtiö palauttaa sen perustasoon (AOYL 4:2 § 2 ja 3 mom).",
    x: 700,
    y: 310,
  },
  {
    key: "sauna-lattiakaivo",
    room: "sauna",
    label: "Saunan lattiakaivo ja vedeneristys",
    responsibility: "company",
    text: "Kaivo kuuluu viemärijärjestelmään ja vedeneristys rakenteen eristeisiin, joten molemmat ovat yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom",
    note: "Kaivon puhdistus on asukkaan tavanomaista hoitoa (AOYL 4:3 § 2 mom).",
    x: 480,
    y: 580,
  },
  {
    key: "sauna-valaisin",
    room: "sauna",
    label: "Saunan valaisin",
    responsibility: "shared",
    text: "Kiinteä sähköjohto ja rasia ovat yhtiön sähköjärjestelmää. Valaisin, sen suojus ja lamppu ovat huoneiston varusteita ja osakkaan.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 1 mom",
    x: 880,
    y: 80,
  },
  {
    key: "sauna-sahkoliitanta",
    room: "sauna",
    label: "Kiukaan sähköliitäntä ja ohjaus",
    responsibility: "company",
    text: "Kiukaan syöttökaapeli, kytkentärasia ja ohjauskeskus ovat osa yhtiön sähköjärjestelmää, joten yhtiö vastaa niistä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Kiukaan vaihdosta on ilmoitettava yhtiölle etukäteen kirjallisesti (AOYL 4:7 §). Liitännän saa tehdä vain sähköalan ammattilainen.",
    x: 85,
    y: 240,
  },
];

const OLOHUONE: ResponsibilityItem[] = [
  {
    key: "olohuone-pinnat",
    room: "olohuone",
    label: "Pinnat: maalaus, tapetit ja lattia",
    responsibility: "shareholder",
    text: "Seinien, katon ja lattian pintamateriaalit ovat huoneiston sisäosia, joten osakas vastaa niiden kunnossapidosta ja uusimisesta.",
    law: "AOYL 4:3 § 1 mom",
    note: "Jos pinta vahingoittuu rakenteen tai yhtiön vastuulla olevan osan vian tai korjaamisen takia, yhtiö korjaa sen perustasoon (AOYL 4:2 § 2 ja 3 mom).",
    x: 140,
    y: 200,
  },
  {
    key: "olohuone-pistorasiat",
    room: "olohuone",
    label: "Pistorasiat ja kytkimet",
    responsibility: "company",
    text: "Rasiat, kytkimet ja kiinteät johdot kuuluvat yhtiön sähköjärjestelmään myös huoneiston sisällä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan teettämät lisärasiat jäävät osakkaalle, jollei yhtiö ole hyväksynyt niitä vastuulleen (AOYL 4:2 § 3 mom).",
    x: 470,
    y: 450,
  },
  {
    key: "olohuone-antennirasia",
    room: "olohuone",
    label: "Antenni- ja tietoliikennerasia",
    responsibility: "company",
    text: "Tiedonsiirtojärjestelmä on laissa nimetty yhtiön perusjärjestelmäksi, joten antenni- ja laajakaistarasia sekä niiden runkokaapelointi ovat yhtiön.",
    law: "AOYL 4:2 § 2 mom",
    note: "Rasiasta eteenpäin olevat laitteet, johdot ja jakajat ovat asukkaan.",
    x: 350,
    y: 330,
  },
  {
    key: "olohuone-sahkokeskus",
    room: "olohuone",
    label: "Huoneiston sähkökeskus",
    responsibility: "company",
    text: "Ryhmäkeskus, sen suojalaitteet ja sulakkeet ovat osa yhtiön sähköjärjestelmää, joten yhtiö vastaa niistä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Palaneen sulakkeen vaihto ja vikavirtasuojan testaus ovat asukkaan tavanomaista hoitoa.",
    x: 930,
    y: 190,
  },
  {
    key: "olohuone-poistoventtiili",
    room: "olohuone",
    label: "Ilmanvaihdon poistoventtiili",
    responsibility: "company",
    text: "Venttiili on osa yhtiön ilmanvaihtojärjestelmää, joten yhtiö vastaa sen kunnosta ja säädöstä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Asukas puhdistaa venttiilin pinnan eikä muuta säätöä.",
    x: 300,
    y: 60,
  },
  {
    key: "olohuone-patteri",
    room: "olohuone",
    label: "Patteri ja termostaatti",
    responsibility: "company",
    text: "Patteri, sen venttiilit ja termostaatti kuuluvat yhtiön lämmitysjärjestelmään, joten yhtiö vastaa niistä ja perussäädöstä.",
    law: "AOYL 4:2 § 2 mom",
    note: "Patterin pinnan maalaus on huoneiston sisäosaa ja siten osakkaan; termostaatin saa säätää, mutta sitä ei saa irrottaa.",
    x: 710,
    y: 415,
  },
];

const PARVEKE: ResponsibilityItem[] = [
  {
    key: "parveke-laatta",
    room: "parveke",
    label: "Parvekelaatta ja kaiteet",
    responsibility: "company",
    text: "Laatta ja kaide ovat rakennuksen rakenteita ja ulkopintaa. Yhtiö pitää rakennuksen ulkopinnan kunnossa myös osakkaan hallinnassa olevan parvekkeen kohdalla.",
    law: "AOYL 4:2 § 2 ja 4 mom",
    note: "Kaiteeseen tai laattaan porattava kiinnitys on muutostyö, josta on ilmoitettava yhtiölle etukäteen kirjallisesti (AOYL 5:2 §).",
    x: 700,
    y: 450,
  },
  {
    key: "parveke-lasit",
    room: "parveke",
    label: "Parvekelasit",
    responsibility: "shared",
    text: "Yhtiön toteuttamat tai vastuulleen hyväksymät parvekelasit ovat rakennuksen osa ja yhtiön vastuulla. Osakkaan itse hankkimat lasit jäävät osakkaalle.",
    law: "AOYL 4:2 § 3 ja 4 mom",
    note: "Lasien pesu ja tiivisteiden puhtaanapito on asukkaan tavanomaista hoitoa. Tämä on tyypillisin kohta, jossa yhtiöjärjestys tai yhtiökokouksen päätös määrää toisin.",
    x: 560,
    y: 200,
  },
  {
    key: "parveke-pinnat",
    room: "parveke",
    label: "Parvekkeen pinnat ja lattian pesu",
    responsibility: "shared",
    text: "Yhtiö vastaa lattian ja seinien pinnoitteen kunnosta rakennuksen ulkopintana. Parvekkeen siisteys ja pesu kuuluvat osakkaalle, koska parveke on osa osakehuoneistoa.",
    law: "AOYL 1:3 § 2 mom, 4:2 § 4 mom ja 4:3 § 2 mom",
    note: "Pesuvettä ei saa valuttaa alempiin parvekkeisiin eikä rakenteisiin. Jos parvekkeelle on kulku useammasta huoneistosta, osakkaat sopivat sen kunnossapidosta keskenään ja jakavat kulut tasan, ellei yhtiöjärjestys määrää toisin (AOYL 1:3 § 2 mom).",
    x: 280,
    y: 510,
  },
  {
    key: "parveke-valaisin",
    room: "parveke",
    label: "Parvekkeen valaisin ja pistorasia",
    responsibility: "company",
    text: "Yhtiön toteuttama valaisin ja pistorasia ovat osa sähköjärjestelmää ja yhtiön vastuulla.",
    law: "AOYL 4:2 § 2 mom",
    note: "Osakkaan itse asennuttama parvekepistorasia tai valaisin jää osakkaalle ja edellyttää yhtiölle tehtyä ilmoitusta (AOYL 4:2 § 3 mom ja 4:7 §).",
    x: 180,
    y: 170,
  },
  {
    key: "parveke-lumi",
    room: "parveke",
    label: "Lumen ja jään poisto parvekkeelta",
    responsibility: "shareholder",
    text: "Parveke kuuluu osakehuoneistoon, ja osakkaan on hoidettava huoneistoaan huolellisesti. Lumen poisto kuuluu siksi osakkaalle, jottei rakenne kuormitu eikä vesi pääse rakenteisiin.",
    law: "AOYL 1:3 § 2 mom ja 4:3 § 2 mom",
    note: "Lunta ei saa pudottaa kaiteen yli. Kattolumet ja jääpuikot ovat yhtiön kiinteistönhoitoa.",
    x: 900,
    y: 480,
  },
];

const PIHA: ResponsibilityItem[] = [
  {
    key: "piha-alue",
    room: "piha",
    label: "Huoneistokohtainen piha-alue",
    responsibility: "shared",
    text: "Piha on kiinteistön osa, jonka kunnossapidosta yhtiö vastaa. Osakas saa hallintaoikeuden piha-alueeseen vain, jos yhtiöjärjestyksessä niin määrätään, ja hallinnassaan olevan alueen tavanomainen hoito ja siisteys kuuluvat silloin osakkaalle.",
    law: "AOYL 1:3 § 1 mom, 4:2 § 1 mom ja 4:3 § 2 mom",
    note: "Rajaus vaihtelee yhtiöittäin eniten juuri piha-alueissa. Tarkista yhtiöjärjestys. Jos käytät pihaa ilman yhtiöjärjestykseen tai vuokrasopimukseen perustuvaa hallintaoikeutta, hoida sitä huolellisesti ja ilmoita sen vioista yhtiölle (AOYL 4:3 § 3 mom ja 4:8 § 2 mom, voimaan 1.10.2026).",
    x: 300,
    y: 380,
  },
  {
    key: "piha-istutukset",
    room: "piha",
    label: "Istutukset ja nurmikko",
    responsibility: "shared",
    text: "Yhtiön istuttamat pensaat, puut ja nurmikko ovat yhtiön kunnossapitoa. Osakkaan omalle piha-alueelleen istuttamat kasvit ovat osakkaan.",
    law: "AOYL 4:2 § 1 mom ja 4:3 § 2 mom",
    note: "Puun kaataminen ja istutusten poistaminen edellyttävät yhtiön lupaa.",
    x: 640,
    y: 330,
  },
  {
    key: "piha-aidat",
    room: "piha",
    label: "Aidat ja pihan rakenteet",
    responsibility: "company",
    text: "Aidat, tukimuurit ja muut pihan kiinteät rakenteet ovat kiinteistön rakenteita, joten yhtiö vastaa niiden kunnosta.",
    law: "AOYL 4:2 § 1 ja 2 mom",
    note: "Osakkaan rakentama aita tai terassi on muutostyö, josta on ilmoitettava yhtiölle etukäteen, ja se jää osakkaan vastuulle (AOYL 5:1–2 §). Yhtiön hallinnassa olevalle alueelle rakentaminen edellyttää yhtiön suostumusta.",
    x: 840,
    y: 480,
  },
  {
    key: "piha-ulkovarasto",
    room: "piha",
    label: "Ulkovarasto",
    responsibility: "shared",
    text: "Varastorakennus, sen ovi, katto ja lukko ovat yhtiön rakennusta ja siten yhtiön vastuulla. Varaston siisteys ja sisällön turvallinen säilytys kuuluvat käyttäjälle.",
    law: "AOYL 4:2 § 2 mom ja 4:3 § 2 mom",
    note: "Palavien nesteiden ja kaasupullojen säilytystä rajoittaa paloturvallisuus; katso yhtiön pelastussuunnitelma.",
    x: 800,
    y: 200,
  },
  {
    key: "piha-valaisin",
    room: "piha",
    label: "Pihavalaisin",
    responsibility: "company",
    text: "Pihavalaisimet ja niiden kaapelointi kuuluvat kiinteistön sähköjärjestelmään, joten yhtiö vastaa niistä.",
    law: "AOYL 4:2 § 2 mom",
    x: 600,
    y: 165,
  },
  {
    key: "piha-sadevesi",
    room: "piha",
    label: "Sadevesijärjestelmä",
    responsibility: "company",
    text: "Kourut, syöksytorvet, rännikaivot ja salaojat ovat kiinteistön ja rakennuksen järjestelmiä, joten yhtiö vastaa niiden kunnosta ja puhdistuksesta.",
    law: "AOYL 4:2 § 1 ja 2 mom",
    note: "Tukkeutuneesta rännistä tai kaivosta kannattaa ilmoittaa heti, koska vesi pääsee rakenteisiin (AOYL 4:8 §).",
    x: 292,
    y: 150,
  },
  {
    key: "piha-talvikunnossapito",
    room: "piha",
    label: "Kulkuväylien talvikunnossapito",
    responsibility: "shared",
    text: "Yhtiö vastaa yhteisten kulkuväylien auraamisesta ja hiekoituksesta osana kiinteistönhoitoa. Osakkaan hallinnassa olevan piha-alueen ja sen kulkuväylän hoito on osakkaan.",
    law: "AOYL 4:2 § 1 mom ja 4:3 § 2 mom",
    note: "Yhtiökokous voi päättää, että yhtiö hoitaa myös huoneistopihojen lumityöt (AOYL 4:1 § 2 mom).",
    x: 220,
    y: 560,
  },
];

export const ITEMS: ResponsibilityItem[] = [...KEITTIO, ...KYLPYHUONE, ...OVET, ...IKKUNAT, ...SAUNA, ...OLOHUONE, ...PARVEKE, ...PIHA];

export function itemsForRoom(room: RoomKey): ResponsibilityItem[] {
  return ITEMS.filter((i) => i.room === room);
}

export function findItem(key: string): ResponsibilityItem | undefined {
  return ITEMS.find((i) => i.key === key);
}

/**
 * Näkyy aina taulukon yhteydessä. Vastuunjako on tahdonvaltaista siltä osin
 * kuin yhtiöjärjestyksessä määrätään toisin (AOYL 4:1 § 1 mom), joten
 * taulukko ei ratkaise yksittäistä riitaa.
 */
export const GENERAL_DISCLAIMER =
  "Taulukko kertoo asunto-osakeyhtiölain mukaisen yleisen vastuunjaon. Yhtiöjärjestys voi määrätä toisin, ja yksittäinen vahinko ratkaistaan aina tapauskohtaisesti. Tarkista epäselvä tilanne isännöitsijältä ennen työn aloittamista.";

/** Lähteet näkyviin sivulla ja kirjattuna DECISIONS.md:hen. */
export const LEGAL_SOURCES = [
  "Asunto-osakeyhtiölaki 1599/2009, 4 luku (kunnossapito) ja 1 luvun 3 § (osakehuoneisto ja parveke)",
  "Finlexin avoin data: opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2009/1599",
];

/**
 * Kuka saa tehdä ja kuka maksaa, kun kunnossapito viivästyy (AOYL 4:4–4:5 §).
 * Näytetään taulukon yhteydessä ja lyhyesti huoltopyyntölomakkeella.
 */
export const URGENT_REPAIR_NOTES = [
  "Kiireellinen vika yhtiön vastuulla: saat teettää huoneistossasi korjauksen yhtiön kustannuksella, jos se on tarpeen lisävahingon välttämiseksi. Ilmoita yhtiölle heti (AOYL 4:4 § 2 mom ja 4:7 § 5 mom).",
  "Muu yhtiön vastuulla oleva vika, josta on sinulle vähäistä suurempaa haittaa: tee ensin kirjallinen huomautus. Jos yhtiö ei ryhdy viivytyksettä riittäviin toimiin, saat teettää työn yhtiön kustannuksella (AOYL 4:4 § 2 mom).",
  "Yhtiön hallinnassa olevat tilat: saat teettää yhtiön vastuulla olevan työn yhtiön kustannuksella, jos vika rajoittaa olennaisesti huoneistosi käyttöä ja yhtiö ei kirjallisen huomautuksen jälkeen toimi viivytyksettä (AOYL 4:5 §).",
  "Osakkaan laiminlyönti: yhtiö voi teettää osakkaan vastuulla olevan työn osakkaan kustannuksella, jos laiminlyönnistä voi aiheutua haittaa yhtiölle tai toiselle osakkaalle (AOYL 4:4 § 1 mom).",
  "Kustannukset korvataan tarpeellisilta ja kohtuullisilta osin (AOYL 4:4 § 3 mom ja 4:5 § 3 mom).",
];

/** Lyhyt versio huoltopyyntölomakkeelle. */
export const URGENT_REPAIR_SHORT =
  "Jos vika on yhtiön vastuulla ja kiireellinen, saat estää lisävahingon teettämällä korjauksen yhtiön kustannuksella. Ilmoita yhtiölle heti.";

/** Ilmoitusvelvollisuudet, jotka on hyvä kertoa osakkaalle taulukon yhteydessä. */
export const DUTY_NOTES = [
  "Ilmoita yhtiölle viivytyksettä huoneiston viasta, jonka korjaaminen kuuluu yhtiölle (AOYL 4:8 §).",
  "Tee oma kunnossapitotyö tunnetuksi kirjallisella ilmoituksella etukäteen, jos se voi vaikuttaa yhtiön tai toisen osakkaan vastuulla olevaan osaan (AOYL 4:7 §).",
  "Yhtiöllä on oikeus valvoa osakkaan kunnossapitotyötä, ja osakas vastaa tarpeellisista valvontakuluista (AOYL 4:9 §).",
  "Jos annat huoneiston toisen käyttöön, pidä tiedot käyttäjästä tallessa ja anna ne yhtiölle sen perustellusta pyynnöstä (AOYL 4:3 § 4 mom, voimaan 1.10.2026).",
];
