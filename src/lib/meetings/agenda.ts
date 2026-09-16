import type { AgendaItemTemplate } from "./templates";

/**
 * Varsinaisen yhtiökokouksen esityslista yhtiön yhtiöjärjestyksen mukaan
 * (AOYL 6:3 §). Rakenne ja sanamuodot Jukan esityslistamallin mukaan
 * (As Oy Paikkalantorpat 2025), täydennettynä laissa esitettäväksi
 * vaadituilla hallituksen selvityksillä. Hallituksen ja tarkastajien määrät
 * vaihtelevat yhtiöittäin (0097).
 */

export type AuditorKind = "operations_auditor" | "auditor" | "optional";

export interface CompanyGovernance {
  boardMembersMin: number | null;
  boardMembersMax: number | null;
  boardDeputiesMin: number | null;
  boardDeputiesMax: number | null;
  auditorKind: AuditorKind | null;
  auditorsCount: number | null;
  deputyAuditorsCount: number | null;
  /** Kiinteistöosakeyhtiö: kunnossapitotarveselvitys ei ole lakisääteinen (osakeyhtiölaki). */
  isHousingCompany: boolean;
}

const WORDS = ["nolla", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän", "kymmenen"];

/** Lukusana perusmuodossa (1–10), muuten numero. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** "yksi varsinainen jäsen", "kolme varsinaista jäsentä": suomen partitiivi lukusanan jälkeen. */
function counted(n: number, singular: string, partitive: string): string {
  return `${numberWord(n)} ${n === 1 ? singular : partitive}`;
}

function range(min: number | null, max: number | null): { min: number; max: number } | null {
  if (min === null && max === null) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  return { min: lo, max: hi };
}

/** Hallituksen valinta-asian otsikko. Väli → kokous päättää ensin lukumäärästä. */
export function boardElectionTitle(g: CompanyGovernance): string {
  const members = range(g.boardMembersMin, g.boardMembersMax);
  const deputies = range(g.boardDeputiesMin, g.boardDeputiesMax);
  if (!members) return "Valitaan hallituksen jäsenet yhtiöjärjestyksen mukainen määrä.";

  const deputyText = (() => {
    if (!deputies || deputies.max === 0) return "";
    if (deputies.min === deputies.max) return ` ja ${counted(deputies.min, "varajäsen", "varajäsentä")}`;
    if (deputies.min === 0) return ` sekä tarvittaessa enintään ${counted(deputies.max, "varajäsen", "varajäsentä")}`;
    return ` sekä ${numberWord(deputies.min)}–${numberWord(deputies.max)} varajäsentä`;
  })();

  if (members.min === members.max) {
    return `Valitaan hallituksen jäsenet: ${counted(members.min, "varsinainen jäsen", "varsinaista jäsentä")}${deputyText}.`;
  }
  return `Päätetään hallituksen jäsenten lukumäärästä ja valitaan hallituksen jäsenet (yhtiöjärjestyksen mukaan ${numberWord(members.min)}–${numberWord(members.max)} varsinaista jäsentä${deputyText}).`;
}

const AUDITOR_NOUN: Record<Exclude<AuditorKind, "optional">, { one: string; many: string; deputyOne: string; deputyMany: string }> = {
  operations_auditor: { one: "varsinainen toiminnantarkastaja", many: "varsinaista toiminnantarkastajaa", deputyOne: "varatoiminnantarkastaja", deputyMany: "varatoiminnantarkastajaa" },
  auditor: { one: "varsinainen tilintarkastaja", many: "varsinaista tilintarkastajaa", deputyOne: "varatilintarkastaja", deputyMany: "varatilintarkastajaa" },
};

/** Tarkastajan valinta-asian otsikko. */
export function auditorElectionTitle(g: CompanyGovernance): string {
  if (g.auditorKind === "optional" || g.auditorKind === null) {
    return "Päätetään toiminnantarkastajan tai tilintarkastajan valitsemisesta. Yhtiöjärjestyksen mukaan valinta ei ole pakollinen.";
  }
  const n = AUDITOR_NOUN[g.auditorKind];
  const count = g.auditorsCount ?? 1;
  const deputies = g.deputyAuditorsCount ?? 0;
  const main = count === 1 ? `yksi ${n.one}` : `${numberWord(count)} ${n.many}`;
  const deputy = deputies === 0 ? "" : deputies === 1 ? ` ja yksi ${n.deputyOne}` : ` ja ${numberWord(deputies)} ${n.deputyMany}`;
  const tail = g.auditorKind === "auditor" ? "" : " Toiminnantarkastajan sijaan voidaan valita myös tilintarkastaja.";
  return `Valitaan ${main}${deputy}.${tail}`;
}

function reportName(g: CompanyGovernance): string {
  return g.auditorKind === "auditor" ? "tilintarkastuskertomus" : g.auditorKind === "optional" ? "toiminnan- tai tilintarkastuskertomus, jos tarkastaja on valittu" : "toiminnantarkastuskertomus";
}

function feeTitle(g: CompanyGovernance): string {
  if (g.auditorKind === "optional" || g.auditorKind === null) return "Päätetään hallituksen jäsenten ja mahdollisen toiminnantarkastajan palkkioista.";
  const count = (g.auditorsCount ?? 1) + (g.deputyAuditorsCount ?? 0);
  const noun = g.auditorKind === "auditor" ? (count > 1 ? "tilintarkastajien" : "tilintarkastajan") : count > 1 ? "toiminnantarkastajien" : "toiminnantarkastajan";
  return `Päätetään hallituksen jäsenten ja ${noun} palkkioista.`;
}

/**
 * Esityslista. `chairName` lisätään avaukseen kuten mallissa ("hall.pj. Nimi").
 * Muut asiat -kohtaan isännöitsijä lisää kokouskohtaiset asiat.
 */
export function annualGeneralAgenda(g: CompanyGovernance, opts: { chairName?: string | null } = {}): AgendaItemTemplate[] {
  const items: AgendaItemTemplate[] = [
    {
      title: opts.chairName ? `Kokouksen avaus: hallituksen puheenjohtaja ${opts.chairName}` : "Kokouksen avaus",
      proposal: "Kokouksen avaa hallituksen puheenjohtaja tai hallituksen nimeämä henkilö (AOYL 6:23 §).",
    },
    { title: "Valitaan kokoukselle puheenjohtaja ja sihteeri.", proposal: "" },
    {
      title: "Todetaan kokouksen läsnäolijat ja vahvistetaan ääniluettelo.",
      proposal: "Laaditaan luettelo läsnä olevista ja valtakirjalla edustetuista osakkeenomistajista sekä heidän osake- ja äänimääristään (AOYL 6:23 §). Yhden osakkeenomistajan äänimäärä on enintään viidesosa kokouksessa edustetuista äänistä, jollei yhtiöjärjestyksessä toisin määrätä (AOYL 6:13 §).",
    },
    { title: "Todetaan kokouksen laillisuus ja päätösvaltaisuus.", proposal: "" },
    { title: "Valitaan pöytäkirjantarkastajat.", proposal: "Valitaan kaksi pöytäkirjantarkastajaa, jotka toimivat tarvittaessa myös ääntenlaskijoina." },
    {
      title: `Käsitellään päättyneen vuoden tilinpäätös ja toimintakertomus sekä ${reportName(g)}.`,
      proposal: "",
    },
  ];
  if (g.isHousingCompany) {
    items.push({
      title: "Käsitellään hallituksen selvitykset kunnossapitotarpeesta ja yhtiössä tehdyistä kunnossapito- ja muutostöistä.",
      proposal: "Esitetään hallituksen kirjallinen selvitys kunnossapitotarpeesta seuraavan viiden vuoden aikana sekä selvitys yhtiössä suoritetuista huomattavista kunnossapito- ja muutostöistä ja niiden tekoajankohdista (AOYL 6:3 §).",
    });
  }
  items.push(
    { title: "Päätetään tilinpäätöksen vahvistamisesta.", proposal: "" },
    { title: "Päätetään vastuuvapauden myöntämisestä hallitukselle ja isännöitsijälle päättyneen vuoden tileistä ja hallinnosta.", proposal: "" },
    { title: "Päätetään tilikauden tuloksen käsittelystä.", proposal: "" },
    { title: "Käsitellään kuluvalle vuodelle laadittu talousarvio ja päätetään hoitovastikkeen määrästä kuluvalle vuodelle.", proposal: "" },
    { title: feeTitle(g), proposal: "" },
    { title: boardElectionTitle(g), proposal: "" },
    { title: auditorElectionTitle(g), proposal: "" },
    { title: "Muut asiat:", proposal: "Kokouskutsussa mainitut muut asiat. Muista kuin kokouskutsussa mainituista asioista ei voida tehdä päätöksiä." },
    { title: "Kokouksen päättäminen", proposal: "" },
  );
  return items;
}
