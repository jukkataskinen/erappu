import type { CompanyModuleKey } from "@/config/company-tabs";
import type { Sql } from "@/lib/db";
import { contractTiming } from "@/lib/contracts/deadlines";
import { listContracts } from "@/lib/contracts/queries";
import { formatEur, isoDateHelsinki } from "@/lib/format";
import { diffDays, shortFinnishDate } from "@/lib/tasks/dates";
import { OPEN_STATUSES } from "@/lib/service-requests/status";
import { OPEN_FOR_COMPANY } from "@/lib/maintenance/renovation";

/**
 * Yhtiön korttinäkymän tilarivit. Kaikki luvut haetaan yhdellä kyselyllä
 * (skalaarialikyselyt) ja sopimukset erikseen, koska irtisanomisajan laskenta
 * on sovelluksessa. Kyselyt ajetaan käyttäjän transaktiossa, joten RLS rajaa
 * luvut samoin kuin moduulisivuilla.
 */

export type ModuleTone = "neutral" | "alert" | "warn" | "ok";
export type ModuleStatus = Partial<Record<CompanyModuleKey, { text: string; tone?: ModuleTone }>>;

interface Counts {
  apartments: number;
  other_units: number;
  owners: number;
  board_members: number;
  chair_name: string | null;
  buildings: number;
  open_requests: number;
  open_notices: number;
  planned_needs: number;
  next_meeting_at: string | Date | null;
  draft_announcements: number;
  last_published_at: string | Date | null;
  documents: number;
  overdue_tasks: number;
  next_task_on: string | null;
  resources: number;
  upcoming_bookings: number;
  latest_reading_on: string | null;
  open_orders: number;
  pending_diffs: number;
  payment_as_of: string | null;
  overdue_eur: string | null;
  rescue_review_on: string | null;
  rescue_draft: boolean;
  responsibility_exceptions: number;
  water_meters: number;
  water_open_round: string | null;
}

async function loadCounts(tx: Sql, companyId: string, today: string): Promise<Counts> {
  const [row] = await tx.query<Counts>(
    `select
       (select count(*)::int from er_share_groups where company_id = $1 and removed_on is null and kind = 'apartment') as apartments,
       (select count(*)::int from er_share_groups where company_id = $1 and removed_on is null and kind <> 'apartment') as other_units,
       (select count(distinct o.party_id)::int from er_ownerships o join er_share_groups g on g.id = o.share_group_id
         where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= $2::date)) as owners,
       (select count(*)::int from er_board_memberships where company_id = $1 and role in ('chair', 'member', 'deputy')
         and (ends_on is null or ends_on >= $2::date)) as board_members,
       (select p.display_name from er_board_memberships b join er_parties p on p.id = b.party_id
         where b.company_id = $1 and b.role = 'chair' and (b.ends_on is null or b.ends_on >= $2::date) order by b.starts_on desc limit 1) as chair_name,
       (select count(*)::int from er_buildings where company_id = $1) as buildings,
       (select count(*)::int from er_service_requests where company_id = $1 and status = any($3::text[])) as open_requests,
       (select count(*)::int from er_renovation_notices where company_id = $1 and status = any($4::text[])) as open_notices,
       (select count(*)::int from er_maintenance_needs where company_id = $1 and status in ('planned', 'decided', 'in_progress')) as planned_needs,
       (select min(starts_at) from er_meetings where company_id = $1 and starts_at >= date_trunc('day', now()) and status in ('draft', 'notice_sent')) as next_meeting_at,
       (select count(*)::int from er_announcements where company_id = $1 and status = 'draft') as draft_announcements,
       (select max(published_at) from er_announcements where company_id = $1 and status = 'published') as last_published_at,
       (select count(*)::int from er_documents where company_id = $1) as documents,
       (select count(*)::int from er_tasks where company_id = $1 and done_at is null and due_on < $2::date) as overdue_tasks,
       (select min(due_on)::text from er_tasks where company_id = $1 and done_at is null and due_on >= $2::date) as next_task_on,
       (select count(*)::int from er_bookable_resources where company_id = $1 and active) as resources,
       (select count(*)::int from er_bookings where company_id = $1 and cancelled_at is null and starts_at >= now()) as upcoming_bookings,
       (select max(period_end)::text from er_consumption_readings where company_id = $1 and share_group_id is null) as latest_reading_on,
       (select count(*)::int from er_certificate_orders where company_id = $1 and status in ('new', 'in_progress')) as open_orders,
       (select count(*)::int from er_htj_diffs where company_id = $1 and status = 'pending') as pending_diffs,
       (select max(as_of)::text from er_payment_status where company_id = $1) as payment_as_of,
       (select sum(overdue_eur)::text from er_payment_status where company_id = $1
         and as_of = (select max(as_of) from er_payment_status where company_id = $1)) as overdue_eur,
       (select next_review_on::text from er_rescue_plans where company_id = $1 and status = 'final' and superseded_at is null) as rescue_review_on,
       exists (select 1 from er_rescue_plans where company_id = $1 and status = 'draft') as rescue_draft,
       (select count(*)::int from er_responsibility_exceptions where company_id = $1) as responsibility_exceptions,
       (select count(*)::int from er_water_meters where company_id = $1 and removed_on is null) as water_meters,
       (select read_on::text from er_water_reading_rounds where company_id = $1 and status = 'open' order by read_on desc limit 1) as water_open_round`,
    [companyId, today, OPEN_STATUSES, OPEN_FOR_COMPANY],
  );
  return row;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function shortDate(iso: string, today: string): string {
  return shortFinnishDate(iso, iso.slice(0, 4) !== today.slice(0, 4));
}

function isoOf(value: string | Date): string {
  return isoDateHelsinki(value instanceof Date ? value : new Date(value));
}

/** Pelastussuunnitelman tila: tarkistus myöhässä, lähestyy (60 pv) tai voimassa. */
export function rescuePlanStatus(reviewOn: string | null, draft: boolean, today: string): { text: string; tone: ModuleTone } {
  if (!reviewOn) return draft ? { text: "Luonnos kesken", tone: "warn" } : { text: "Ei suunnitelmaa", tone: "warn" };
  if (reviewOn < today) return { text: `Tarkistus myöhässä (${shortDate(reviewOn, today)})`, tone: "alert" };
  if (diffDays(today, reviewOn) <= 60) return { text: `Tarkistus ${shortDate(reviewOn, today)}`, tone: "warn" };
  return { text: `Voimassa, tarkistus ${shortDate(reviewOn, today)}`, tone: "ok" };
}

export async function loadCompanyModuleStatus(
  tx: Sql,
  company: { id: string; organization_id: string; htj_synced_at: string | Date | null },
  today: string,
): Promise<ModuleStatus> {
  const [c, contracts] = await Promise.all([loadCounts(tx, company.id, today), listContracts(tx, { organizationId: company.organization_id, companyId: company.id })]);
  const timings = contracts.map((k) => contractTiming(k, today)).filter((t) => t.effectiveStatus !== "ended");
  const endingSoon = timings.filter((t) => t.endingSoon).length;
  const s: ModuleStatus = {};

  s.huoneistot =
    c.apartments + c.other_units === 0
      ? { text: "Ei huoneistoja", tone: "warn" }
      : { text: `${plural(c.apartments, "huoneisto", "huoneistoa")}${c.other_units ? ` + ${c.other_units} muuta` : ""}` };
  if (c.owners > 0) s.osakkaat = { text: plural(c.owners, "osakas", "osakasta") };
  if (c.board_members > 0) s.hallitus = { text: c.chair_name ? `Pj. ${c.chair_name}` : plural(c.board_members, "jäsen", "jäsentä") };
  else s.hallitus = { text: "Hallitusta ei kirjattu", tone: "warn" };
  if (c.buildings > 0) s.kiinteisto = { text: plural(c.buildings, "rakennus", "rakennusta") };

  s.htj =
    c.pending_diffs > 0
      ? { text: `${c.pending_diffs} HTJ-eroa käsittelemättä`, tone: "warn" }
      : company.htj_synced_at
        ? { text: `HTJ synkronoitu ${shortDate(isoOf(company.htj_synced_at), today)}`, tone: "ok" }
        : { text: "Ei HTJ-vertailua", tone: "neutral" };

  s.huolto = c.open_requests > 0 ? { text: plural(c.open_requests, "avoin huoltopyyntö", "avointa huoltopyyntöä"), tone: "alert" } : { text: "Ei avoimia pyyntöjä", tone: "ok" };
  if (c.open_notices > 0) s.korjaukset = { text: plural(c.open_notices, "muutostyöilmoitus odottaa", "muutostyöilmoitusta odottaa"), tone: "alert" };
  else if (c.planned_needs > 0) s.korjaukset = { text: plural(c.planned_needs, "suunniteltu korjaus", "suunniteltua korjausta") };

  if (c.draft_announcements > 0) s.tiedotteet = { text: plural(c.draft_announcements, "luonnos odottaa", "luonnosta odottaa"), tone: "warn" };
  else if (c.last_published_at) s.tiedotteet = { text: `Viimeksi julkaistu ${shortDate(isoOf(c.last_published_at), today)}` };

  if (c.resources > 0) s.varaukset = { text: `${plural(c.resources, "kohde", "kohdetta")} · ${plural(c.upcoming_bookings, "tuleva varaus", "tulevaa varausta")}` };
  if (c.overdue_tasks > 0) s.vuosikello = { text: plural(c.overdue_tasks, "tehtävä myöhässä", "tehtävää myöhässä"), tone: "alert" };
  else if (c.next_task_on) s.vuosikello = { text: `Seuraava määräaika ${shortDate(c.next_task_on, today)}` };
  if (c.water_open_round) s.vesi = { text: `Lukukierros ${shortDate(c.water_open_round, today)} auki`, tone: "warn" };
  else if (c.water_meters > 0) s.vesi = { text: plural(c.water_meters, "mittari", "mittaria") };
  if (c.latest_reading_on) s.kulutus = { text: `Lukemat ${shortDate(c.latest_reading_on, today)} asti` };
  s.pelastussuunnitelma = rescuePlanStatus(c.rescue_review_on, c.rescue_draft, today);
  s.vastuunjako =
    c.responsibility_exceptions > 0
      ? { text: plural(c.responsibility_exceptions, "yhtiökohtainen poikkeus", "yhtiökohtaista poikkeusta") }
      : { text: "Lain mukainen yleinen jako", tone: "neutral" };

  if (c.payment_as_of) {
    s.talous =
      Number(c.overdue_eur ?? 0) > 0
        ? { text: `Erääntynyt ${formatEur(c.overdue_eur)} (${shortDate(c.payment_as_of, today)})`, tone: "alert" }
        : { text: `Maksutilanne ${shortDate(c.payment_as_of, today)}, ei erääntyneitä`, tone: "ok" };
  }
  s.kokoukset = c.next_meeting_at ? { text: `Seuraava kokous ${shortDate(isoOf(c.next_meeting_at), today)}` } : { text: "Ei tulevia kokouksia", tone: "neutral" };
  if (c.documents > 0) s.dokumentit = { text: plural(c.documents, "dokumentti", "dokumenttia") };
  if (timings.length > 0) {
    s.sopimukset = endingSoon > 0 ? { text: `${timings.length} voimassa · ${endingSoon} päättymässä`, tone: "warn" } : { text: `${timings.length} voimassa` };
  }
  if (c.open_orders > 0) s.todistukset = { text: plural(c.open_orders, "avoin tilaus", "avointa tilausta"), tone: "alert" };
  return s;
}
