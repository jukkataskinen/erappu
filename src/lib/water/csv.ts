import { splitCsvLine } from "@/lib/consumption/csv";
import type { MeterKind } from "./settlement";

/**
 * Vesimittarilukemien CSV-tuonti lukukierrokselle (etäluettavat mittarit,
 * huoltoyhtiön lukulista). Otsikkorivi on pakollinen; sarakkeet tunnistetaan
 * nimestä. Mittari löytyy mittarinumerosta tai huoneistosta ja tyypistä.
 *
 *   mittari;huoneisto;tyyppi;lukema
 *   12345678;A 1;kylmä;221,5
 */

export const MAX_READING_ROWS = 2000;

export interface CsvMeter {
  id: string;
  unit_label: string;
  kind: MeterKind;
  meter_number: string | null;
  removed_on: string | null;
}

export interface ReadingCsvResult {
  readings: { meterId: string; value: string }[];
  errors: string[];
  /** Rivejä yhteensä (otsikkoa lukuun ottamatta). */
  rows: number;
}

const HEADERS: Record<"meter" | "unit" | "kind" | "reading", RegExp> = {
  meter: /^(mittari(numero|nro)?|mittarin numero|meter( ?(number|id|no))?|sarjanumero)$/,
  unit: /^(huoneisto|asunto|huoneistotunnus|unit|apartment)$/,
  kind: /^(tyyppi|laji|mittarityyppi|vesi|kind|type)$/,
  reading: /^(lukema|uusi lukema|mittarilukema|reading|value|m3|m³)$/,
};

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");

function parseKind(v: string): MeterKind | null {
  const s = norm(v);
  if (!s) return null;
  if (/^(k|kv|kylmä|kylma|kylmävesi|kylmavesi|cold)/.test(s)) return "cold";
  if (/^(l|lv|lämmin|lammin|lämminvesi|lamminvesi|lämmin käyttövesi|hot|warm)/.test(s)) return "hot";
  return null;
}

function parseValue(v: string): string | null {
  const s = v.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d+)?$/.test(s)) return null;
  // Etäluenta antaa usein enemmän desimaaleja kuin kanta tallentaa (3).
  const [whole, frac = ""] = s.split(".");
  const rounded = Math.round(Number(`${whole}.${frac}`) * 1000) / 1000;
  return String(rounded);
}

export function parseReadingsCsv(text: string, meters: CsvMeter[]): ReadingCsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { readings: [], errors: ["Tiedostossa ei ole rivejä otsikkorivin jälkeen."], rows: 0 };
  if (lines.length - 1 > MAX_READING_ROWS) return { readings: [], errors: [`Enintään ${MAX_READING_ROWS} riviä kerralla.`], rows: lines.length - 1 };
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());
  const col = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].test(h));
  const cMeter = col("meter");
  const cUnit = col("unit");
  const cKind = col("kind");
  const cReading = col("reading");
  if (cReading < 0) return { readings: [], errors: ["Otsikkoriviltä puuttuu lukeman sarake (esim. \"lukema\")."], rows: lines.length - 1 };
  if (cMeter < 0 && cUnit < 0) return { readings: [], errors: ["Otsikkoriviltä puuttuu mittarinumeron tai huoneiston sarake."], rows: lines.length - 1 };

  const active = meters.filter((m) => !m.removed_on);
  const byNumber = new Map(active.filter((m) => m.meter_number).map((m) => [norm(m.meter_number!), m]));
  const readings: { meterId: string; value: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const rowNo = i + 1;
    const get = (c: number) => (c >= 0 ? (cells[c] ?? "").trim() : "");
    const rawValue = get(cReading);
    if (!rawValue) continue;
    const value = parseValue(rawValue);
    if (value === null) {
      errors.push(`Rivi ${rowNo}: lukema "${rawValue}" ei ole luku.`);
      continue;
    }
    let meter: CsvMeter | undefined;
    const number = get(cMeter);
    if (number) meter = byNumber.get(norm(number));
    if (!meter) {
      const unit = get(cUnit);
      if (unit) {
        const candidates = active.filter((m) => norm(m.unit_label) === norm(unit));
        const kind = parseKind(get(cKind));
        const matching = kind ? candidates.filter((m) => m.kind === kind) : candidates;
        if (matching.length === 1) meter = matching[0];
        else if (matching.length > 1) {
          errors.push(`Rivi ${rowNo}: huoneistossa ${unit} on useita mittareita. Lisää mittarinumero tai tyyppi (kylmä/lämmin).`);
          continue;
        }
      }
    }
    if (!meter) {
      errors.push(`Rivi ${rowNo}: mittaria ${[number, get(cUnit), get(cKind)].filter(Boolean).join(" / ") || "(tyhjä)"} ei löytynyt.`);
      continue;
    }
    if (seen.has(meter.id)) {
      errors.push(`Rivi ${rowNo}: mittarille ${meter.unit_label}${meter.meter_number ? ` nro ${meter.meter_number}` : ""} on jo lukema aiemmalla rivillä.`);
      continue;
    }
    seen.add(meter.id);
    readings.push({ meterId: meter.id, value });
  }
  return { readings, errors, rows: lines.length - 1 };
}
