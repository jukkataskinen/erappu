import { parseFiDate } from "./dates";
import { centsToFi, parseScaled } from "./money";
import { normalizeReference, normalizeUnitLabel } from "./references";

/**
 * Maksutilanteen CSV-tuonti kirjanpidon reskontraraportista.
 *
 * Sarakkeet tunnistetaan otsikoista (kirjainkoolla ja BOM:lla ei väliä):
 *   viitenumero | viite          – osakeryhmän vastikeviite (kotimainen tai RF)
 *   huoneisto                    – huoneiston tunnus, jos viite puuttuu
 *   avoin | avoinna | saldo      – avoin saldo euroina (pakollinen)
 *   erääntynyt | erääntyneet     – eräpäivän ohittanut osa euroina
 *   vanhin eräpäivä | eräpäivä   – vanhimman avoimen erän eräpäivä
 * Muut sarakkeet (esim. asiakkaan nimi) ohitetaan eikä niitä tallenneta.
 * Erotin on puolipiste, sarkain tai pilkku; desimaalit pilkulla tai pisteellä.
 */

export interface ParsedPaymentRow {
  line: number;
  reference: string | null;
  unitLabel: string | null;
  openCents: bigint;
  overdueCents: bigint;
  oldestDueOn: string | null;
}

export interface ParseResult {
  rows: ParsedPaymentRow[];
  errors: string[];
}

const HEADERS: Record<"reference" | "unit" | "open" | "overdue" | "oldest", string[]> = {
  reference: ["viitenumero", "viite", "viitenro", "viitenumero/rf", "reference"],
  unit: ["huoneisto", "huoneistotunnus", "osakeryhmä", "osakeryhma", "kohde"],
  open: ["avoin", "avoinna", "avoin saldo", "avoimet", "saldo", "avoin summa"],
  overdue: ["erääntynyt", "erääntyneet", "eraantynyt", "erääntynyt saldo", "myöhässä", "erääntynyt summa"],
  oldest: ["vanhin eräpäivä", "vanhin erapaiva", "eräpäivä", "erapaiva", "vanhin erä"],
};

function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase()
    .replace(/\((€|eur)\)|\beur\b|€/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDelimiter(headerLine: string): string {
  const count = (ch: string) => headerLine.split(ch).length - 1;
  const candidates: [string, number][] = [[";", count(";")], ["\t", count("\t")], [",", count(",")]];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ";";
}

/** Yksi CSV-rivi kenttiin; lainausmerkit ja tuplatut lainausmerkit huomioiden. */
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
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseAmount(raw: string): bigint | null {
  let v = raw.replace(/[\s  €]/g, "").replace(/−/g, "-");
  if (v === "") return 0n;
  // Kirjanpito merkitsee joskus negatiivisen perään: 12,00-.
  if (/^\d.*-$/.test(v)) v = `-${v.slice(0, -1)}`;
  // Tuhaterottimena voi olla piste, jos desimaalit ovat pilkulla: 1.234,50.
  const value = /,\d{1,2}$/.test(v) ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return null;
  return parseScaled(value, 2);
}

/** Tiedoston sisältö tekstiksi: UTF-8 (BOM:lla tai ilman), muuten Windows-1252. */
export function decodeCsv(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(bytes);
}

export function parsePaymentCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerIndex < 0) return { rows: [], errors: ["Tiedosto on tyhjä."] };
  const delimiter = detectDelimiter(lines[headerIndex]);
  const headers = splitCsvLine(lines[headerIndex], delimiter).map(normalizeHeader);
  const col = (key: keyof typeof HEADERS) => headers.findIndex((h) => HEADERS[key].includes(h));
  const idx = { reference: col("reference"), unit: col("unit"), open: col("open"), overdue: col("overdue"), oldest: col("oldest") };

  const errors: string[] = [];
  if (idx.open < 0) errors.push("Sarake avoin saldo puuttuu (otsikko esim. \"Avoin\").");
  if (idx.reference < 0 && idx.unit < 0) errors.push("Sarake viitenumero tai huoneisto puuttuu.");
  if (errors.length) return { rows: [], errors };

  const rows: ParsedPaymentRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const cells = splitCsvLine(lines[i], delimiter);
    const lineNo = i + 1;
    const get = (n: number) => (n >= 0 ? (cells[n] ?? "") : "");
    const open = parseAmount(get(idx.open));
    const overdue = idx.overdue >= 0 ? parseAmount(get(idx.overdue)) : 0n;
    if (open === null || overdue === null) {
      errors.push(`Rivi ${lineNo}: summa ei ole luku.`);
      continue;
    }
    const oldestRaw = get(idx.oldest);
    const oldest = oldestRaw ? parseFiDate(oldestRaw) : null;
    if (oldestRaw && !oldest) {
      errors.push(`Rivi ${lineNo}: eräpäivä ei ole päivämäärä.`);
      continue;
    }
    const reference = get(idx.reference) || null;
    const unitLabel = get(idx.unit) || null;
    if (!reference && !unitLabel) {
      // Yhteenvetorivi ("Yhteensä") tai tyhjä: ei kohdistettavaa.
      continue;
    }
    rows.push({ line: lineNo, reference, unitLabel, openCents: open, overdueCents: overdue, oldestDueOn: oldest });
  }
  return { rows, errors };
}

export interface MatchCandidate {
  shareGroupId: string;
  unitLabel: string;
  reference: string | null;
}

export interface MatchedStatus {
  shareGroupId: string;
  reference: string | null;
  openCents: bigint;
  overdueCents: bigint;
  oldestDueOn: string | null;
  lines: number[];
}

export interface UnmatchedRow {
  line: number;
  reference: string | null;
  unit_label: string | null;
  open_eur: string;
  overdue_eur: string;
  reason: string;
}

/**
 * Kohdistus: ensisijaisesti viitteellä, toissijaisesti huoneiston
 * tunnuksella. Saman osakeryhmän useat rivit (esim. erät) lasketaan yhteen.
 */
export function matchPaymentRows(rows: ParsedPaymentRow[], candidates: MatchCandidate[]): { matched: MatchedStatus[]; unmatched: UnmatchedRow[] } {
  const byRef = new Map<string, MatchCandidate>();
  const byUnit = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    if (c.reference) byRef.set(c.reference, c);
    byUnit.set(normalizeUnitLabel(c.unitLabel), c);
  }

  const matched = new Map<string, MatchedStatus>();
  const unmatched: UnmatchedRow[] = [];
  for (const r of rows) {
    const ref = r.reference ? normalizeReference(r.reference) : null;
    let target: MatchCandidate | undefined;
    let reason = "";
    if (ref) {
      target = byRef.get(ref);
      if (!target) reason = "Viitettä ei löydy tämän yhtiön osakeryhmistä.";
    } else if (r.reference) {
      reason = "Viitenumero ei ole kelvollinen.";
    }
    if (!target && r.unitLabel) {
      target = byUnit.get(normalizeUnitLabel(r.unitLabel));
      if (!target) reason = reason || "Huoneistoa ei löydy yhtiöstä.";
    }
    if (!target) {
      unmatched.push({
        line: r.line,
        reference: r.reference,
        unit_label: r.unitLabel,
        open_eur: centsToFi(r.openCents),
        overdue_eur: centsToFi(r.overdueCents),
        reason: reason || "Ei kohdistettavaa tietoa.",
      });
      continue;
    }
    const prev = matched.get(target.shareGroupId);
    if (prev) {
      prev.openCents += r.openCents;
      prev.overdueCents += r.overdueCents;
      if (r.oldestDueOn && (!prev.oldestDueOn || r.oldestDueOn < prev.oldestDueOn)) prev.oldestDueOn = r.oldestDueOn;
      prev.lines.push(r.line);
    } else {
      matched.set(target.shareGroupId, {
        shareGroupId: target.shareGroupId,
        reference: target.reference,
        openCents: r.openCents,
        overdueCents: r.overdueCents,
        oldestDueOn: r.oldestDueOn,
        lines: [r.line],
      });
    }
  }
  return { matched: [...matched.values()], unmatched };
}
