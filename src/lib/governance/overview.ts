import type { Sql } from "@/lib/db";
import type { MeetingKind, MeetingStatus } from "@/lib/meetings/labels";

/**
 * Työpöydän hallinto-osio: yhtiöittäin viimeisin talousarvio, tilinpäätös,
 * yhtiökokous ja hallituksen kokous. Asiakirjat luetaan dokumenteista
 * (kategoria + vuosi). Kokoukset luetaan sekä kokousmoduulista (er_meetings)
 * että pöytäkirjadokumenteista, koska vanhat ja muualla pidetyt kokoukset on
 * tallennettu pelkkinä pöytäkirjoina. Pöytäkirjan kokoustyyppi ja päivä
 * päätellään otsikosta tai tiedostonimestä.
 */

export type Health = "ok" | "warn" | "alert";

export interface GovernanceDoc {
  id: string;
  title: string;
  /** Tilikausi tai talousarviovuosi. Null, jos vuotta ei ole kirjattu dokumentille. */
  year: number | null;
  created_at: string;
}

export interface GovernanceMeeting {
  id: string;
  kind: MeetingKind;
  starts_at: string;
  status: MeetingStatus;
}

/** Pöytäkirjadokumentti kokouksen tietona. `date` on otsikosta tai tiedostonimestä luettu päivä. */
export interface GovernanceMinutes {
  id: string;
  title: string;
  date: string | null;
  year: number;
  created_at: string;
}

export type LastMeeting = ({ source: "meeting" } & GovernanceMeeting) | ({ source: "document" } & GovernanceMinutes);

export interface GovernanceRow {
  company_id: string;
  company_name: string;
  budget: GovernanceDoc | null;
  statement: GovernanceDoc | null;
  general: LastMeeting | null;
  next_general: GovernanceMeeting | null;
  board: LastMeeting | null;
  next_board: GovernanceMeeting | null;
}

type RawRow = Omit<GovernanceRow, "general" | "board"> & { general: GovernanceMeeting | null; board: GovernanceMeeting | null };

export interface MinutesDocRow {
  id: string;
  company_id: string;
  title: string;
  file_name: string;
  year: number | null;
  created_at: string;
}

/** Päättelee pöytäkirjan kokoustyypin nimestä. Null, jos tyyppi ei selviä. */
export function minutesKind(text: string): "general" | "board" | null {
  const t = text.toLowerCase();
  if (/yhti[oö]kokou/.test(t)) return "general";
  if (/hallitu/.test(t)) return "board";
  return null;
}

/** Lukee päivän muodoista 20260529, 2026-05-29 ja 29.5.2026. */
export function minutesDate(text: string): string | null {
  const iso = text.match(/(?<!\d)(20\d{2})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fi = text.match(/(?<!\d)(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])\.(20\d{2})(?!\d)/);
  if (fi) return `${fi[3]}-${fi[2].padStart(2, "0")}-${fi[1].padStart(2, "0")}`;
  return null;
}

/** Kokouksen päivä vertailua varten. Päivättömälle pöytäkirjalle tallennuspäivä, kuitenkin enintään vuoden loppu. */
export function meetingDate(m: LastMeeting): Date {
  if (m.source === "meeting") return new Date(m.starts_at);
  if (m.date) return new Date(`${m.date}T12:00:00Z`);
  const created = new Date(m.created_at);
  const yearEnd = new Date(`${m.year}-12-31T12:00:00Z`);
  return created < yearEnd ? created : yearEnd;
}

/** Valitsee uusimman kokouksen kokousmoduulin ja pöytäkirjojen joukosta. */
export function latestMeeting(meeting: GovernanceMeeting | null, docs: MinutesDocRow[], kind: "general" | "board"): LastMeeting | null {
  const candidates: LastMeeting[] = [];
  if (meeting) candidates.push({ source: "meeting", ...meeting });
  for (const d of docs) {
    const text = `${d.title} ${d.file_name}`;
    if (minutesKind(text) !== kind) continue;
    const date = minutesDate(text);
    const year = d.year ?? (date ? Number(date.slice(0, 4)) : new Date(d.created_at).getFullYear());
    candidates.push({ source: "document", id: d.id, title: d.title, date, year, created_at: String(d.created_at) });
  }
  return candidates.reduce<LastMeeting | null>((best, m) => {
    if (!best) return m;
    const diff = meetingDate(m).getTime() - meetingDate(best).getTime();
    if (diff !== 0) return diff > 0 ? m : best;
    return m.source === "document" && best.source === "document" && m.created_at > best.created_at ? m : best;
  }, null);
}

const DOC = (category: string) => `(
  select json_build_object('id', d.id, 'title', d.title, 'year', d.year, 'created_at', d.created_at)
    from er_documents d
   where d.company_id = c.id and d.category = '${category}'
   order by d.year desc nulls last, d.created_at desc
   limit 1)`;

const MEETING = (kinds: string, past: boolean) => `(
  select json_build_object('id', m.id, 'kind', m.kind, 'starts_at', m.starts_at, 'status', m.status)
    from er_meetings m
   where m.company_id = c.id and m.kind in (${kinds}) and m.status <> 'cancelled'
     and ${past ? "(m.starts_at <= now() or m.status in ('held', 'minutes_signed'))" : "m.starts_at > now() and m.status in ('draft', 'notice_sent')"}
   order by m.starts_at ${past ? "desc" : "asc"}
   limit 1)`;

const GENERAL = "'annual_general', 'extraordinary_general'";

export async function listGovernanceOverview(tx: Sql, organizationId: string): Promise<GovernanceRow[]> {
  const rows = await tx.query<RawRow>(
    `select c.id as company_id, c.name as company_name,
            ${DOC("budget")} as budget,
            ${DOC("financial_statement")} as statement,
            ${MEETING(GENERAL, true)} as general,
            ${MEETING(GENERAL, false)} as next_general,
            ${MEETING("'board'", true)} as board,
            ${MEETING("'board'", false)} as next_board
       from er_housing_companies c
      where c.organization_id = $1 and c.management_ended_on is null
      order by c.name`,
    [organizationId],
  );
  const minutes = await tx.query<MinutesDocRow>(
    `select d.id, d.company_id, d.title, d.file_name, d.year, d.created_at
       from er_documents d join er_housing_companies c on c.id = d.company_id
      where c.organization_id = $1 and c.management_ended_on is null and d.category = 'minutes'`,
    [organizationId],
  );
  return rows.map((r) => {
    const docs = minutes.filter((d) => d.company_id === r.company_id);
    return { ...r, general: latestMeeting(r.general, docs, "general"), board: latestMeeting(r.board, docs, "board") };
  });
}

/**
 * Tilanteen arviointi olettaa kalenterivuoden tilikauden ja varsinaisen
 * yhtiökokouksen kesäkuun loppuun mennessä (AOYL 6:8 §).
 */
const helsinkiParts = (now: Date) => {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "numeric" })
    .formatToParts(now)
    .filter((p) => p.type === "year" || p.type === "month")
    .map((p) => Number(p.value));
  return { year, month };
};

/** Talousarvio kuluvalle vuodelle hyväksytään viimeistään kevään yhtiökokouksessa. */
export function budgetHealth(doc: GovernanceDoc | null, now = new Date()): Health {
  const { year, month } = helsinkiParts(now);
  if (!doc) return "alert";
  if (doc.year === null) return "warn";
  if (doc.year >= year) return "ok";
  if (doc.year === year - 1 && month <= 6) return "warn";
  return "alert";
}

/** Edellisen tilikauden tilinpäätös kuuluu olla valmis kesäkuun loppuun mennessä. */
export function statementHealth(doc: GovernanceDoc | null, now = new Date()): Health {
  const { year, month } = helsinkiParts(now);
  if (!doc) return "alert";
  if (doc.year === null) return "warn";
  if (doc.year >= year - 1) return "ok";
  if (doc.year === year - 2 && month <= 6) return "warn";
  return "alert";
}

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

/** Yhtiökokous kuluvana vuonna; alkuvuonna edellisen vuoden kokous riittää, jos uusi on tulossa. */
export function generalHealth(last: LastMeeting | null, next: GovernanceMeeting | null, now = new Date()): Health {
  const { year, month } = helsinkiParts(now);
  const lastYear = last ? (last.source === "document" ? last.year : helsinkiParts(meetingDate(last)).year) : null;
  if (lastYear !== null && lastYear >= year) return "ok";
  if (month <= 6) return next || (lastYear !== null && lastYear === year - 1) ? "warn" : "alert";
  return "alert";
}

/** Hallituksen kokous puolen vuoden sisällä on ok, vuoden sisällä huomautus. */
export function boardHealth(last: LastMeeting | null, next: GovernanceMeeting | null, now = new Date()): Health {
  if (!last) return next ? "warn" : "alert";
  const age = now.getTime() - meetingDate(last).getTime();
  if (age <= 6 * MONTH_MS) return "ok";
  if (age <= 12 * MONTH_MS || next) return "warn";
  return "alert";
}
