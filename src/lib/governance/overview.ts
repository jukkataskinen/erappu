import type { Sql } from "@/lib/db";
import type { MeetingKind, MeetingStatus } from "@/lib/meetings/labels";

/**
 * Työpöydän hallinto-osio: yhtiöittäin viimeisin talousarvio, tilinpäätös,
 * yhtiökokous ja hallituksen kokous. Asiakirjat luetaan dokumenteista
 * (kategoria + vuosi), kokoukset er_meetings-taulusta.
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

export interface GovernanceRow {
  company_id: string;
  company_name: string;
  budget: GovernanceDoc | null;
  statement: GovernanceDoc | null;
  general: GovernanceMeeting | null;
  next_general: GovernanceMeeting | null;
  board: GovernanceMeeting | null;
  next_board: GovernanceMeeting | null;
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
  return tx.query<GovernanceRow>(
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
export function generalHealth(last: GovernanceMeeting | null, next: GovernanceMeeting | null, now = new Date()): Health {
  const { year, month } = helsinkiParts(now);
  const lastYear = last ? helsinkiParts(new Date(last.starts_at)).year : null;
  if (lastYear !== null && lastYear >= year) return "ok";
  if (month <= 6) return next || (lastYear !== null && lastYear === year - 1) ? "warn" : "alert";
  return "alert";
}

/** Hallituksen kokous puolen vuoden sisällä on ok, vuoden sisällä huomautus. */
export function boardHealth(last: GovernanceMeeting | null, next: GovernanceMeeting | null, now = new Date()): Health {
  if (!last) return next ? "warn" : "alert";
  const age = now.getTime() - new Date(last.starts_at).getTime();
  if (age <= 6 * MONTH_MS) return "ok";
  if (age <= 12 * MONTH_MS || next) return "warn";
  return "alert";
}
