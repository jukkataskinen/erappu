import { isIsoDate, toIsoDate, type IsoDate } from "@/lib/tasks/dates";
import { normalizeBusinessId } from "@/lib/validation/finnish";
import type { ConsumptionUnit, Utility } from "./labels";

/**
 * Kulutuslukemien CSV-tuonti.
 *
 * Sarakkeet järjestyksessä: yhtiö (Y-tunnus tai nimi), laji, alkupvm, loppupvm,
 * määrä, yksikkö, kustannus (valinnainen). Erotin ; tai tabulaattori tai ,
 * (Excelin suomalainen CSV käyttää puolipistettä ja desimaalipilkkua).
 * Otsikkorivi tunnistetaan siitä, ettei sen päivämääriä voi lukea.
 */

export interface ParsedReading {
  line: number;
  company: string;
  utility: Utility;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amount: number;
  unit: ConsumptionUnit;
  costEur: number | null;
}

export interface CsvResult {
  rows: ParsedReading[];
  errors: { line: number; message: string }[];
}

export const MAX_CSV_ROWS = 5000;

function detectDelimiter(firstLine: string): string {
  if (firstLine.includes(";")) return ";";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseFinnishDate(value: string): IsoDate | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (!m) return null;
  const iso = toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return isIsoDate(iso) ? iso : null;
}

export function parseFinnishNumber(value: string): number | null {
  const v = value.replace(/[\s €]/g, "").replace(",", ".");
  if (v === "" || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

export function parseUtility(value: string): Utility | null {
  const v = value.trim().toLowerCase();
  if (["sähkö", "sahko", "electricity", "kiinteistösähkö"].includes(v)) return "electricity";
  if (["vesi", "water", "käyttövesi"].includes(v)) return "water";
  if (["lämpö", "lampo", "lämmitys", "kaukolämpö", "heat", "heating"].includes(v)) return "heat";
  return null;
}

export function parseUnit(value: string): ConsumptionUnit | null {
  const v = value.trim().toLowerCase().replace("³", "3");
  if (v === "kwh") return "kWh";
  if (v === "mwh") return "MWh";
  if (v === "m3") return "m3";
  return null;
}

export function parseConsumptionCsv(text: string): CsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const firstContent = lines.find((l) => l.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstContent);
  const rows: ParsedReading[] = [];
  const errors: CsvResult["errors"] = [];
  let seenContent = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const lineNo = i + 1;
    const cols = splitCsvLine(raw, delimiter);
    const isFirst = !seenContent;
    seenContent = true;
    if (isFirst && cols.length >= 4 && !parseFinnishDate(cols[2] ?? "")) continue; // otsikkorivi

    if (rows.length + errors.length >= MAX_CSV_ROWS) {
      errors.push({ line: lineNo, message: `Enintään ${MAX_CSV_ROWS} riviä kerralla.` });
      break;
    }
    if (cols.length < 6) {
      errors.push({ line: lineNo, message: "Rivillä on liian vähän sarakkeita." });
      continue;
    }
    const [company, utilityRaw, startRaw, endRaw, amountRaw, unitRaw, costRaw = ""] = cols;
    const utility = parseUtility(utilityRaw);
    const periodStart = parseFinnishDate(startRaw);
    const periodEnd = parseFinnishDate(endRaw);
    const amount = parseFinnishNumber(amountRaw);
    const unit = parseUnit(unitRaw);
    const costEur = costRaw.trim() === "" ? null : parseFinnishNumber(costRaw);

    const problem =
      !company ? "Yhtiö puuttuu." :
      !utility ? "Laji on sähkö, vesi tai lämpö." :
      !periodStart || !periodEnd ? "Päivämäärä muodossa p.k.vvvv tai vvvv-kk-pp." :
      periodEnd < periodStart ? "Loppupäivä on ennen alkupäivää." :
      amount === null || amount < 0 ? "Määrä ei ole kelvollinen luku." :
      !unit ? "Yksikkö on kWh, MWh tai m3." :
      (utility === "water") !== (unit === "m3") ? "Veden yksikkö on m3, sähkön ja lämmön kWh tai MWh." :
      costRaw.trim() !== "" && (costEur === null || costEur < 0) ? "Kustannus ei ole kelvollinen luku." :
      null;
    if (problem) {
      errors.push({ line: lineNo, message: problem });
      continue;
    }
    rows.push({ line: lineNo, company, utility: utility!, periodStart: periodStart!, periodEnd: periodEnd!, amount: amount!, unit: unit!, costEur });
  }
  return { rows, errors };
}

/** Yhtiö Y-tunnuksella tai nimellä (kirjainkoolla ei väliä). */
export function resolveCompany<T extends { id: string; name: string; business_id: string }>(value: string, companies: T[]): T | null {
  const bid = normalizeBusinessId(value);
  const byId = companies.find((c) => c.business_id === bid);
  if (byId) return byId;
  const name = value.trim().toLocaleLowerCase("fi");
  return companies.find((c) => c.name.trim().toLocaleLowerCase("fi") === name) ?? null;
}
