import { daysInMonth, parseIsoDate, type IsoDate } from "./dates";
import type { TaskCategory } from "./labels";

/**
 * Vuosikello ympyränä (Jukan malli 17.9.2026): vuodenajat reunalla,
 * hallitus ja yhtiökokous ulkokehällä, kuukaudet keskellä, kiinteistön
 * tehtävät ja asukasviestintä sisäkehillä. Tammikuu on ylhäällä ja aika
 * kulkee myötäpäivään.
 */

export type WheelRingKey = "board" | "property" | "communication";

export interface WheelRing {
  key: WheelRingKey;
  label: string;
  categories: readonly TaskCategory[];
  radius: number;
}

export const WHEEL_SIZE = 440;
export const WHEEL_CENTER = WHEEL_SIZE / 2;
export const DOT_RADIUS = 9;

export const WHEEL_RINGS: readonly WheelRing[] = [
  { key: "board", label: "Hallitus ja yhtiökokous", categories: ["board_meeting", "general_meeting", "financial_statement", "htj_update"], radius: 178 },
  { key: "property", label: "Kiinteistö, vakuutukset ja sopimukset", categories: ["maintenance", "safety", "insurance", "contract", "other"], radius: 118 },
  { key: "communication", label: "Asukasviestintä", categories: ["communication"], radius: 88 },
];

export const MONTH_RING = { inner: 138, outer: 160 } as const;
export const SEASON_RING = { inner: 196, outer: 214 } as const;

export const MONTH_SHORT = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"] as const;

/** Vuodenajat kuukausina (talvi joulu–helmi). */
export const SEASONS = [
  { key: "winter", label: "Talvi", startMonth: 12, months: 3 },
  { key: "spring", label: "Kevät", startMonth: 3, months: 3 },
  { key: "summer", label: "Kesä", startMonth: 6, months: 3 },
  { key: "autumn", label: "Syksy", startMonth: 9, months: 3 },
] as const;

export interface WheelItem {
  title: string;
  date: IsoDate;
  category: TaskCategory;
  href?: string;
}

export interface WheelMarker extends WheelItem {
  number: number;
  ring: WheelRingKey;
  /** Kulma asteina, 0 = ylhäällä, myötäpäivään. */
  angle: number;
  x: number;
  y: number;
}

/** Päivämäärän kulma: kuukausi ja päivä kuukauden sisällä. */
export function dateAngle(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return ((month - 1 + (day - 0.5) / daysInMonth(year, month)) / 12) * 360;
}

export function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: Math.round((WHEEL_CENTER + radius * Math.cos(rad)) * 10) / 10, y: Math.round((WHEEL_CENTER + radius * Math.sin(rad)) * 10) / 10 };
}

export function ringOf(category: TaskCategory): WheelRingKey {
  return WHEEL_RINGS.find((r) => r.categories.includes(category))?.key ?? "property";
}

/**
 * Merkit kehille. Numerointi aikajärjestyksessä (sama numero selitteessä).
 * Päällekkäiset merkit siirretään kehällä eteenpäin, jotta numerot erottuvat.
 */
export function layoutWheel(items: WheelItem[]): WheelMarker[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "fi"));
  const markers: WheelMarker[] = sorted.map((item, i) => ({ ...item, number: i + 1, ring: ringOf(item.category), angle: dateAngle(item.date), x: 0, y: 0 }));
  for (const ring of WHEEL_RINGS) {
    const minGap = (((DOT_RADIUS * 2 + 2) / ring.radius) * 180) / Math.PI;
    const onRing = markers.filter((m) => m.ring === ring.key).sort((a, b) => a.angle - b.angle);
    for (let i = 1; i < onRing.length; i++) {
      if (onRing[i].angle - onRing[i - 1].angle < minGap) onRing[i].angle = onRing[i - 1].angle + minGap;
    }
    for (const m of onRing) Object.assign(m, polar(m.angle % 360, ring.radius));
  }
  return markers;
}

/** SVG-kaaren polku kahden säteen väliin (renkaan sektori). */
export function arcPath(startAngle: number, endAngle: number, inner: number, outer: number): string {
  const large = endAngle - startAngle > 180 ? 1 : 0;
  const a = polar(startAngle, outer);
  const b = polar(endAngle, outer);
  const c = polar(endAngle, inner);
  const d = polar(startAngle, inner);
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}
