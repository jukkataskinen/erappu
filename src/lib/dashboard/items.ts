import { addDays, diffDays, startOfWeek, type IsoDate } from "@/lib/tasks/dates";

/**
 * Työpöydän yhteinen tehtävälista. Jokainen moduuli tuottaa omat rivinsä
 * (src/widgets/*: `dashboardItems`), ja työpöytä järjestää ne
 * kiireellisyyden mukaan: myöhässä, odottaa vastausta, sitten päivämäärän
 * mukaan. Kokoukset ovat tapahtumia, jotka näkyvät vain aikajanalla.
 */

export type ItemCategory =
  | "yhteydenotto" | "huolto" | "tori" | "muutostyo" | "tiedote" | "viesti" | "vuosikello" | "sopimus"
  | "kokous" | "allekirjoitus" | "todistus" | "talous" | "vesi";

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  yhteydenotto: "Yhteydenotto",
  huolto: "Huolto",
  tori: "Tori",
  muutostyo: "Muutostyö",
  tiedote: "Tiedote",
  viesti: "Viestit",
  vuosikello: "Vuosikello",
  sopimus: "Sopimus",
  kokous: "Kokous",
  allekirjoitus: "Allekirjoitus",
  todistus: "Todistus",
  talous: "Talous",
  vesi: "Vesi",
};

export interface DashboardItem {
  id: string;
  category: ItemCategory;
  title: string;
  companyId: string | null;
  companyName: string | null;
  context?: string | null;
  href: string;
  action: string;
  /** Määräpäivä. Null: odottaa toimintaa heti (esim. vastaamaton viesti). */
  dueOn: IsoDate | null;
  /** Odottaa isännöinnin vastausta tai käsittelyä. */
  waiting?: boolean;
  /** Milloin odottaminen alkoi (järjestys ja "odottanut N pv"). */
  since?: IsoDate | null;
  /** Tapahtuma (kokous): vain aikajanalle, ei tehtävälistaan. */
  event?: boolean;
  /** Samanlaiset rivit (esim. vastikeajo tekemättä) yhdistetään yhdeksi. */
  group?: { key: string; href: string };
}

export interface HealthRow {
  key: string;
  label: string;
  companies: { id: string; name: string }[];
  href: string;
  /** alert: oikea virhe tai lakisääteinen myöhästyminen; muuten puuttuva tieto. */
  tone: "alert" | "neutral";
}

export interface DashboardSource {
  items: DashboardItem[];
  health?: HealthRow[];
  /** Yhtiöt, joiden kuluvan kuukauden vastikeajo on tekemättä (talous). */
  billingMissing?: string[];
}

/** Tehtävälistan ikkuna: myöhässä, odottavat ja kahden viikon sisällä erääntyvät. */
export const AGENDA_DAYS = 14;
export const UPCOMING_DAYS = 60;

export function inScope<T extends { companyId: string | null }>(rows: T[], companyIds: Set<string> | null): T[] {
  return companyIds ? rows.filter((r) => r.companyId === null || companyIds.has(r.companyId)) : rows;
}

export function scopeHealth(rows: HealthRow[], companyIds: Set<string> | null): HealthRow[] {
  return rows
    .map((r) => ({ ...r, companies: companyIds ? r.companies.filter((c) => companyIds.has(c.id)) : r.companies }))
    .filter((r) => r.companies.length > 0);
}

/** Yhdistää saman ryhmän rivit: yksi yhtiö → rivi sellaisenaan, useampi → "N yhtiötä" ja ryhmän linkki. */
export function collapseGroups(items: DashboardItem[]): DashboardItem[] {
  const out: DashboardItem[] = [];
  const groups = new Map<string, DashboardItem[]>();
  for (const i of items) {
    if (!i.group) out.push(i);
    else groups.set(i.group.key, [...(groups.get(i.group.key) ?? []), i]);
  }
  for (const [key, rows] of groups) {
    if (rows.length === 1) {
      out.push(rows[0]);
      continue;
    }
    const first = rows.reduce((a, b) => ((a.dueOn ?? "") <= (b.dueOn ?? "") ? a : b));
    out.push({
      ...first,
      id: key,
      companyId: null,
      companyName: null,
      context: `${rows.length} yhtiötä: ${rows.map((r) => r.companyName).filter(Boolean).slice(0, 3).join(", ")}${rows.length > 3 ? " …" : ""}`,
      href: first.group!.href,
    });
  }
  return out;
}

export interface Agenda {
  tasks: DashboardItem[];
  upcoming: DashboardItem[];
  waiting: number;
  overdue: number;
  thisWeek: number;
}

function rank(i: DashboardItem, today: IsoDate): number {
  if (i.dueOn !== null && i.dueOn < today) return 0;
  if (i.dueOn === null) return 1;
  return 2;
}

export function buildAgenda(items: DashboardItem[], today: IsoDate): Agenda {
  const agendaEnd = addDays(today, AGENDA_DAYS);
  const upcomingEnd = addDays(today, UPCOMING_DAYS);
  const weekEnd = addDays(startOfWeek(today), 6);

  const tasks = items
    .filter((i) => !i.event && (i.dueOn === null || i.dueOn <= agendaEnd))
    .sort((a, b) => {
      const r = rank(a, today) - rank(b, today);
      if (r !== 0) return r;
      if (a.dueOn === null && b.dueOn === null) return (a.since ?? "").localeCompare(b.since ?? "");
      return (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.title.localeCompare(b.title, "fi");
    });
  const upcoming = items
    .filter((i) => i.dueOn !== null && i.dueOn <= upcomingEnd && (i.event ? i.dueOn >= today : i.dueOn > agendaEnd))
    .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!) || a.title.localeCompare(b.title, "fi"));

  return {
    tasks,
    upcoming,
    waiting: items.filter((i) => i.waiting).length,
    overdue: tasks.filter((i) => i.dueOn !== null && i.dueOn < today).length,
    thisWeek: tasks.filter((i) => i.dueOn !== null && i.dueOn >= today && i.dueOn <= weekEnd).length,
  };
}

/** Rivin päivämäärämerkintä: "tänään", "myöhässä 3 pv", "odottanut 2 pv" tai päivä. */
export function dueLabel(i: DashboardItem, today: IsoDate): { text: string; tone: "alert" | "warn" | "neutral" } {
  if (i.dueOn === null) {
    const days = i.since ? diffDays(i.since, today) : 0;
    return { text: days > 0 ? `odottanut ${days} pv` : "uusi", tone: days > 2 ? "warn" : "neutral" };
  }
  const d = diffDays(today, i.dueOn);
  if (d < 0) return { text: `myöhässä ${-d} pv`, tone: "alert" };
  if (d === 0) return { text: "tänään", tone: "warn" };
  if (d === 1) return { text: "huomenna", tone: "warn" };
  const [, m, day] = i.dueOn.split("-").map(Number);
  return { text: `${day}.${m}.`, tone: "neutral" };
}
