import { addDays, addMonths, daysInMonth, parseIsoDate, toIsoDate, type IsoDate } from "./dates";
import { normalizeRecurrence, type Recurrence } from "./recurrence";
import type { TaskCategory } from "./labels";

/**
 * Taloyhtiön vakiovuosikello tilikauden perusteella.
 *
 * Määräajat lasketaan tilikauden päättymisestä ja kuukauden viimeinen päivä
 * säilyy (tilikausi päättyy 30.6. → yhtiökokous viimeistään 31.12.).
 * Jokaisesta pohjasta palautetaan seuraava esiintymä, jonka eräpäivä on
 * tänään tai myöhemmin; tehtävät toistuvat vuosittain.
 *
 * Juridiset määräajat: varsinainen yhtiökokous kuuden kuukauden kuluessa
 * tilikauden päättymisestä ja kunnossapitotarveselvitys sen yhteydessä
 * (AOYL 6:3 §). Muut ajat ovat isännöinnin käytäntöjä, jotka jättävät
 * väliin aikaa tilintarkastukselle ja kokouskutsulle.
 *
 * Hallituksen kokoukset ja asukasviestintä Jukan vuosikellomallin mukaan
 * (17.9.2026): hallituksen kokoukset seuraavat tilikautta ja yhtiökokousta,
 * asukasviestintä ja talveen varautuminen vuodenaikoja (kalenterikuukausi).
 */

export interface AnnualTaskTemplate {
  key: string;
  title: string;
  description: string;
  category: TaskCategory;
  due_on: IsoDate;
  recurrence: Recurrence | null;
}

type Template = {
  key: string;
  title: string;
  description: string;
  category: TaskCategory;
} & ({ monthsAfterFiscalEnd: number; calendarMonth?: never } | { calendarMonth: number; monthsAfterFiscalEnd?: never });

const TEMPLATES: Template[] = [
  {
    key: "board_winter",
    title: "Hallituksen kokous: kunnossapitotarve, talousarvio ja viestintä",
    description: "Kunnossapitotarveselvityksen päivitys, talousarvion luonnostelu yhtiökokoukseen ja vuoden asukasviestinnän suunnitelman hahmottelu.",
    category: "board_meeting",
    monthsAfterFiscalEnd: 1,
  },
  {
    key: "board_spring",
    title: "Hallituksen kokous: tilinpäätös ja yhtiökokouksen valmistelu",
    description: "Tilinpäätöksen ja toimintakertomuksen allekirjoitus, yhtiökokouksen esityslista, kokouskutsu ja hallituksen esitykset.",
    category: "board_meeting",
    monthsAfterFiscalEnd: 3,
  },
  {
    key: "financial_statement",
    title: "Tilinpäätös valmis",
    description: "Kirjanpitäjä laatii tilinpäätösluonnoksen ja hallitus allekirjoittaa tilinpäätöksen ja toimintakertomuksen.",
    category: "financial_statement",
    monthsAfterFiscalEnd: 3,
  },
  {
    key: "audit",
    title: "Tilintarkastus tai toiminnantarkastus",
    description: "Tilinpäätös tilintarkastajalle tai toiminnantarkastajalle. Kertomus tarvitaan kokouskutsun liitteeksi.",
    category: "financial_statement",
    monthsAfterFiscalEnd: 4,
  },
  {
    key: "maintenance_needs",
    title: "Kunnossapitotarveselvitys hallitukselle",
    description: "Selvitys seuraavan viiden vuoden kunnossapitotarpeista hallitukselle hyväksyttäväksi ja yhtiökokoukselle esitettäväksi.",
    category: "maintenance",
    monthsAfterFiscalEnd: 4,
  },
  {
    key: "general_meeting",
    title: "Varsinainen yhtiökokous",
    description: "Pidettävä kuuden kuukauden kuluessa tilikauden päättymisestä (AOYL 6:10 §). Kutsu yhtiöjärjestyksen määräajassa.",
    category: "general_meeting",
    monthsAfterFiscalEnd: 6,
  },
  {
    key: "general_meeting_bulletin",
    title: "Yhtiökokoustiedote asukkaille",
    description: "Heti yhtiökokouksen jälkeen: tiedote kokouksen päätöksistä ja muista ajankohtaisista asioista portaaliin (Tiedotteet).",
    category: "communication",
    monthsAfterFiscalEnd: 6,
  },
  {
    key: "board_organizing",
    title: "Hallituksen järjestäytymiskokous",
    description: "Yhtiökokouksen jälkeen: järjestäytyminen ja uusien jäsenten perehdytys tarvittaessa, työjärjestyksen laatiminen, loppuvuoden hankkeiden käynnistys. Hankkeista tiedote ja tarvittaessa asukaskokous.",
    category: "board_meeting",
    monthsAfterFiscalEnd: 6,
  },
  {
    key: "htj_update",
    title: "HTJ-tietojen päivitys",
    description: "Yhtiökokouksen jälkeen: hallitus, tilinpäätöstiedot ja HTJ2-tiedot (vastikkeet, lainat, kunnossapito- ja muutostyöt, kunnossapitotarveselvitys).",
    category: "htj_update",
    monthsAfterFiscalEnd: 7,
  },
  {
    key: "board_summer",
    title: "Hallituksen kokous: tilannekatsaus hankkeisiin",
    description: "Käynnissä olevien hankkeiden tilanne ja seuraavan vuoden hankkeiden suunnittelu.",
    category: "board_meeting",
    monthsAfterFiscalEnd: 8,
  },
  {
    key: "board_autumn",
    title: "Hallituksen kokous: kirjanpidon läpikäynti",
    description: "Kirjanpidon ja talousarvion toteutumisen läpikäynti, vastikkeiden maksutilanne.",
    category: "board_meeting",
    monthsAfterFiscalEnd: 10,
  },
  {
    key: "insurance",
    title: "Vakuutusten tarkistus",
    description: "Kiinteistövakuutuksen laajuus, vakuutusmäärät ja omavastuut ennen seuraavaa vakuutuskautta.",
    category: "insurance",
    monthsAfterFiscalEnd: 10,
  },
  {
    key: "communication_spring",
    title: "Asukastiedote: kevät",
    description: "Katsaus edellisvuoteen, energiankulutus ja poikkeamat kulutuksessa, kevättalkoot, pihavalojen ajastus, lämmityskauden päättyminen ja korvausilmaventtiilit kesäasentoon.",
    category: "communication",
    calendarMonth: 4,
  },
  {
    key: "communication_summer",
    title: "Asukastiedote: kesä",
    description: "Pihakasvien kastelu sadevedellä, muistutus patteritermostaattien kääntämisestä, jotta ne eivät jumitu, ja huoneistojen viilentäminen helteillä.",
    category: "communication",
    calendarMonth: 6,
  },
  {
    key: "communication_autumn",
    title: "Asukastiedote: syksy",
    description: "Huonetilojen oikeat lämpötilat ja termostaattien säätö, ikkunoiden ja ovien tiiviys.",
    category: "communication",
    calendarMonth: 9,
  },
  {
    key: "winter_preparation",
    title: "Talveen varautuminen: kiinteistö- ja pihakierros",
    description: "Kiinteistökierros ja pihakierros ennen talvea: räystäät ja kourut, ulkovalaistus, lumitöiden ja hiekoituksen valmius, vesikalusteiden jäätymisriskit.",
    category: "maintenance",
    calendarMonth: 10,
  },
  {
    key: "communication_winter",
    title: "Asukastiedote: talvi",
    description: "Korvausilmaventtiilit talviasentoon ja ohjeet tuuletukseen.",
    category: "communication",
    calendarMonth: 11,
  },
];

/** Kalenterikuukauden viimeinen päivä, joka on tänään tai myöhemmin. */
function nextMonthEnd(month: number, today: IsoDate): IsoDate {
  const { year } = parseIsoDate(today);
  const thisYear = toIsoDate(year, month, daysInMonth(year, month));
  return thisYear >= today ? thisYear : toIsoDate(year + 1, month, daysInMonth(year + 1, month));
}

/** Tilikauden alku "KK-PP" → päättymispäivä sinä vuonna alkaneelle tilikaudelle. */
export function fiscalYearEnd(fiscalYearStart: string, startYear: number): IsoDate {
  const [mm, dd] = fiscalYearStart.split("-").map(Number);
  if (!mm || !dd || mm < 1 || mm > 12) throw new Error("Tilikauden alku muodossa KK-PP");
  const nextStart = toIsoDate(startYear + 1, mm, Math.min(dd, daysInMonth(startYear + 1, mm)));
  return addDays(nextStart, -1);
}

/** Viimeisin tilikauden päättymispäivä, joka on tänään tai aiemmin. */
export function lastFiscalYearEnd(fiscalYearStart: string, today: IsoDate): IsoDate {
  const { year } = parseIsoDate(today);
  for (const startYear of [year, year - 1, year - 2]) {
    const end = fiscalYearEnd(fiscalYearStart, startYear);
    if (end <= today) return end;
  }
  throw new Error("Tilikauden päättymistä ei voitu päätellä");
}

export function buildAnnualCycle(input: { fiscalYearStart: string; today: IsoDate; energyCertificateYear?: number | null }): AnnualTaskTemplate[] {
  const { fiscalYearStart, today } = input;
  const lastEnd = lastFiscalYearEnd(fiscalYearStart, today);
  const nextEnd = fiscalYearEnd(fiscalYearStart, parseIsoDate(addDays(lastEnd, 1)).year);

  const out: AnnualTaskTemplate[] = TEMPLATES.map((t) => {
    let due: IsoDate;
    if (t.calendarMonth !== undefined) {
      due = nextMonthEnd(t.calendarMonth, today);
    } else {
      due = addMonths(lastEnd, t.monthsAfterFiscalEnd, { keepMonthEnd: true });
      if (due < today) due = addMonths(nextEnd, t.monthsAfterFiscalEnd, { keepMonthEnd: true });
    }
    return {
      key: t.key,
      title: t.title,
      description: t.description,
      category: t.category,
      due_on: due,
      recurrence: normalizeRecurrence({ freq: "yearly", interval: 1 }, due, { monthEnd: true }),
    };
  });

  const certYear = input.energyCertificateYear;
  if (certYear) {
    // Energiatodistus on voimassa 10 vuotta. Uusi tilataan puoli vuotta ennen.
    let due = toIsoDate(certYear + 9, 7, 1);
    if (due < today) due = today;
    out.push({
      key: "energy_certificate",
      title: "Energiatodistuksen uusiminen",
      description: `Energiatodistus (${certYear}) on voimassa 10 vuotta. Tilaa uusi ennen voimassaolon päättymistä.`,
      category: "maintenance",
      due_on: due,
      recurrence: { freq: "yearly", interval: 10, by_month: 7, by_month_day: 1 },
    });
  } else {
    let due = addMonths(lastEnd, 2, { keepMonthEnd: true });
    if (due < today) due = addMonths(nextEnd, 2, { keepMonthEnd: true });
    out.push({
      key: "energy_certificate",
      title: "Tarkista energiatodistuksen voimassaolo",
      description: "Energiatodistus on voimassa 10 vuotta. Kirjaa todistuksen vuosi rakennuksen tietoihin, niin uusiminen tulee vuosikelloon.",
      category: "maintenance",
      due_on: due,
      recurrence: null,
    });
  }

  return out.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.key.localeCompare(b.key));
}
