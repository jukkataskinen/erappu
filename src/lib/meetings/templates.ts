import type { MeetingKind } from "./labels";

/**
 * Asialistapohjat.
 *
 * LUONNOS: juridinen sisältö on Jukan tarkistettava ennen käyttöä
 * (BLOCKERS 4, DECISIONS 2026-09-15). Varsinaisen yhtiökokouksen asiat
 * noudattavat asunto-osakeyhtiölain 6:3 §:ää ja Accessin kokoukset-taulun
 * §1–§15-rakennetta.
 *
 * Pohjat ovat vakioina eivätkä kantarivejä, koska ne ovat samat kaikille
 * organisaatioille. Organisaatio voi tallentaa oman pohjansa tauluun
 * `er_agenda_templates`, ja se ohittaa vakion.
 */

export interface AgendaItemTemplate {
  title: string;
  proposal: string;
}

export interface AgendaTemplate {
  kind: MeetingKind;
  name: string;
  items: AgendaItemTemplate[];
}

const OPENING: AgendaItemTemplate = {
  title: "Kokouksen avaus",
  proposal: "Hallituksen puheenjohtaja tai isännöitsijä avaa kokouksen.",
};

const ORGANIZING: AgendaItemTemplate = {
  title: "Kokouksen järjestäytyminen",
  proposal: "Valitaan kokoukselle puheenjohtaja ja puheenjohtaja kutsuu sihteerin.",
};

const ATTENDANCE: AgendaItemTemplate = {
  title: "Läsnäolijat ja ääniluettelo",
  proposal: "Todetaan läsnä ja edustettuina olevat osakkaat, tarkastetaan valtakirjat ja vahvistetaan ääniluettelo. Kukaan ei voi äänestää yli viidesosalla kokouksessa edustetusta äänimäärästä (AOYL 6:13 §), ellei yhtiöjärjestyksessä toisin määrätä.",
};

const LEGALITY: AgendaItemTemplate = {
  title: "Kokouksen laillisuus ja päätösvaltaisuus",
  proposal: "Todetaan, että kokous on kutsuttu koolle yhtiöjärjestyksen ja asunto-osakeyhtiölain mukaisesti ja on laillinen ja päätösvaltainen.",
};

const CHECKERS: AgendaItemTemplate = {
  title: "Pöytäkirjantarkastajien ja ääntenlaskijoiden valinta",
  proposal: "Valitaan kaksi pöytäkirjantarkastajaa, jotka toimivat tarvittaessa myös ääntenlaskijoina.",
};

const OTHER: AgendaItemTemplate = {
  title: "Muut asiat",
  proposal: "Käsitellään kokouskutsussa mainitut muut asiat. Muista kuin kokouskutsussa mainituista asioista ei voida tehdä päätöksiä.",
};

const CLOSING: AgendaItemTemplate = {
  title: "Kokouksen päättäminen",
  proposal: "Puheenjohtaja päättää kokouksen.",
};

export const DEFAULT_AGENDA_TEMPLATES: Record<MeetingKind, AgendaTemplate> = {
  annual_general: {
    kind: "annual_general",
    name: "Varsinainen yhtiökokous (AOYL 6:3 §)",
    items: [
      OPENING,
      ORGANIZING,
      ATTENDANCE,
      LEGALITY,
      CHECKERS,
      {
        title: "Tilinpäätös ja toimintakertomus",
        proposal: "Esitetään tilinpäätös ja hallituksen toimintakertomus tilikaudelta.",
      },
      {
        title: "Tilintarkastus- tai toiminnantarkastuskertomus",
        proposal: "Esitetään tilintarkastuskertomus tai toiminnantarkastuskertomus.",
      },
      {
        title: "Tuloslaskelman ja taseen vahvistaminen",
        proposal: "Hallitus esittää, että tuloslaskelma ja tase vahvistetaan.",
      },
      {
        title: "Tilikauden tuloksen käsittely",
        proposal: "Hallitus esittää, että tilikauden tulos kirjataan edellisten tilikausien yli-/alijäämätilille.",
      },
      {
        title: "Vastuuvapaus hallitukselle ja isännöitsijälle",
        proposal: "Päätetään vastuuvapauden myöntämisestä hallituksen jäsenille ja isännöitsijälle tilikaudelta.",
      },
      {
        title: "Kunnossapitotarveselvitys ja hallituksen selvitys kunnossapidosta",
        proposal: "Esitetään hallituksen selvitys yhtiön kunnossapitotarpeesta seuraavan viiden vuoden aikana sekä selvitys kunnossapitotöistä, jotka on tehty edellisen selvityksen jälkeen, ja osakkaiden muutostöistä (AOYL 6:3 §).",
      },
      {
        title: "Talousarvio ja vastikkeet",
        proposal: "Hallitus esittää talousarvion kuluvalle tilikaudelle ja vastikkeiden perusteet.",
      },
      {
        title: "Hallituksen jäsenten ja isännöitsijän palkkiot",
        proposal: "Päätetään hallituksen jäsenten palkkioista ja kulukorvauksista.",
      },
      {
        title: "Hallituksen jäsenten ja varajäsenten valinta",
        proposal: "Valitaan yhtiöjärjestyksen mukainen määrä hallituksen jäseniä ja varajäseniä erovuoroisten tilalle.",
      },
      {
        title: "Tilintarkastajan tai toiminnantarkastajan valinta",
        proposal: "Valitaan tilintarkastaja tai toiminnantarkastaja ja tämän varahenkilö seuraavalle tilikaudelle.",
      },
      OTHER,
      CLOSING,
    ],
  },
  extraordinary_general: {
    kind: "extraordinary_general",
    name: "Ylimääräinen yhtiökokous",
    items: [
      OPENING,
      ORGANIZING,
      ATTENDANCE,
      LEGALITY,
      CHECKERS,
      {
        title: "Kokouskutsussa mainittu asia",
        proposal: "Hallituksen esitys kirjataan tähän.",
      },
      CLOSING,
    ],
  },
  board: {
    kind: "board",
    name: "Hallituksen kokous",
    items: [
      { title: "Kokouksen avaus", proposal: "Puheenjohtaja avaa kokouksen." },
      {
        title: "Laillisuus ja päätösvaltaisuus",
        proposal: "Todetaan, että kokous on laillisesti koolle kutsuttu ja päätösvaltainen, kun yli puolet hallituksen jäsenistä on läsnä.",
      },
      { title: "Esityslistan hyväksyminen", proposal: "Hyväksytään esityslista kokouksen työjärjestykseksi." },
      { title: "Edellisen kokouksen pöytäkirja", proposal: "Todetaan edellisen kokouksen pöytäkirja hyväksytyksi ja allekirjoitetuksi." },
      { title: "Isännöitsijän katsaus", proposal: "Isännöitsijä esittelee yhtiön talouden, huollon ja korjausten tilanteen." },
      { title: "Talous ja maksutilanne", proposal: "Käydään läpi talousarvion toteutuminen ja vastikkeiden maksutilanne." },
      { title: "Korjaukset ja muutostyöilmoitukset", proposal: "Käsitellään vireillä olevat korjaukset ja osakkaiden muutostyöilmoitukset." },
      OTHER,
      { title: "Seuraava kokous", proposal: "Sovitaan seuraavan kokouksen ajankohta." },
      CLOSING,
    ],
  },
};

/** Pohja: organisaation oma, jos sellainen on, muuten vakio. */
export function resolveAgenda(kind: MeetingKind, custom?: AgendaItemTemplate[] | null): AgendaItemTemplate[] {
  const source = custom && custom.length > 0 ? custom : DEFAULT_AGENDA_TEMPLATES[kind].items;
  return source.map((i) => ({ title: i.title.trim(), proposal: (i.proposal ?? "").trim() })).filter((i) => i.title);
}

/**
 * Kokouskutsun viimeinen lähetyspäivä. AOYL 6:20 §: kutsu toimitetaan
 * aikaisintaan kaksi kuukautta ja viimeistään kaksi viikkoa ennen kokousta,
 * ellei yhtiöjärjestyksessä määrätä toisin (parametri). Palauttaa ISO-päivän.
 */
export function noticeWindow(startsAtIso: string, minDays = 14, maxDays = 60): { earliest: string; latest: string } {
  const start = new Date(startsAtIso);
  const day = 24 * 60 * 60 * 1000;
  const iso = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(d);
  return { earliest: iso(new Date(start.getTime() - maxDays * day)), latest: iso(new Date(start.getTime() - minDays * day)) };
}
