import type { Sql } from "@/lib/db/types";
import type { MeterKind, MeterReading, WaterAdvance, WaterMeter } from "./settlement";

/**
 * Vesimittareiden, lukukierrosten ja ennakoiden haut. Kutsujan
 * RLS-transaktio: henkilökunta näkee organisaationsa, portaalikäyttäjä
 * oman huoneistonsa (0100).
 */

export interface MeterRow extends WaterMeter {
  unit_label: string;
  location: string | null;
  notes: string | null;
}

export async function listMeters(tx: Sql, companyId: string): Promise<MeterRow[]> {
  const rows = await tx.query<MeterRow>(
    `select m.id, m.share_group_id, g.unit_label, m.kind, m.meter_number, m.location, m.installed_on::text, m.start_reading::text,
            m.removed_on::text, m.final_reading::text, m.notes
       from er_water_meters m join er_share_groups g on g.id = m.share_group_id
      where m.company_id = $1`,
    [companyId],
  );
  return rows.sort(
    (a, b) =>
      a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }) ||
      (a.kind === b.kind ? 0 : a.kind === "cold" ? -1 : 1) ||
      a.installed_on.localeCompare(b.installed_on),
  );
}

export interface RoundRow {
  id: string;
  read_on: string;
  status: "open" | "closed";
  portal_open: boolean;
  note: string | null;
  reading_count: number;
  settlement_run_id: string | null;
  settlement_status: string | null;
}

export async function listRounds(tx: Sql, companyId: string): Promise<RoundRow[]> {
  return tx.query<RoundRow>(
    `select r.id, r.read_on::text, r.status, r.portal_open, r.note,
            (select count(*)::int from er_water_readings x where x.round_id = r.id) as reading_count,
            s.id as settlement_run_id, s.status as settlement_status
       from er_water_reading_rounds r
       left join lateral (
         select b.id, b.status from er_billing_runs b where b.reading_round_id = r.id and b.status <> 'cancelled' limit 1
       ) s on true
      where r.company_id = $1
      order by r.read_on desc`,
    [companyId],
  );
}

export async function getRound(tx: Sql, companyId: string, roundId: string): Promise<RoundRow | null> {
  const rows = await listRounds(tx, companyId);
  return rows.find((r) => r.id === roundId) ?? null;
}

export interface RoundReadingRow {
  meter_id: string;
  reading: string;
  read_on: string;
  source: "staff" | "portal";
  entered_by_name: string | null;
  updated_at: string;
}

export async function listRoundReadings(tx: Sql, roundId: string): Promise<RoundReadingRow[]> {
  return tx.query<RoundReadingRow>(
    `select x.meter_id, x.reading::text, x.read_on::text, x.source, coalesce(u.full_name, u.email) as entered_by_name, x.updated_at
       from er_water_readings x left join er_users u on u.id = x.entered_by
      where x.round_id = $1`,
    [roundId],
  );
}

/** Mittareittain viimeisin tasauksessa laskutettu lukema (ei peruttuja ajoja). */
export async function lastBilledReadings(tx: Sql, companyId: string, excludeRunId?: string): Promise<Map<string, MeterReading>> {
  const rows = await tx.query<{
    meter_id: string;
    reading_end: string;
    reading_end_on: string;
  }>(
    `select distinct on (l.meter_id) l.meter_id, l.reading_end::text, l.reading_end_on::text
       from er_billing_lines l
       join er_billing_runs r on r.id = l.run_id
      where r.company_id = $1 and r.kind = 'water_settlement' and r.status <> 'cancelled'
        and l.meter_id is not null and l.reading_end is not null and ($2::uuid is null or r.id <> $2::uuid)
      order by l.meter_id, l.reading_end_on desc`,
    [companyId, excludeRunId ?? null],
  );
  return new Map(rows.map((r) => [r.meter_id, { value: r.reading_end, on: r.reading_end_on }]));
}

export interface AdvanceRow extends WaterAdvance {
  id: string;
  unit_label: string;
  note: string | null;
}

export async function listAdvances(tx: Sql, companyId: string): Promise<AdvanceRow[]> {
  const rows = await tx.query<AdvanceRow>(
    `select a.id, a.share_group_id, g.unit_label, a.monthly_eur::text, a.starts_on::text, a.ends_on::text, a.note
       from er_water_advances a join er_share_groups g on g.id = a.share_group_id
      where a.company_id = $1`,
    [companyId],
  );
  return rows.sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }) || b.starts_on.localeCompare(a.starts_on));
}

// ---------------------------------------------------------------------------
// Portaali
// ---------------------------------------------------------------------------

export interface PortalMeter {
  id: string;
  shareGroupId: string;
  kind: MeterKind;
  meterNumber: string | null;
  location: string | null;
  lastReading: MeterReading | null;
  /** Avoimen kierroksen lukema, jos jo ilmoitettu. */
  openReading: { value: string; source: "staff" | "portal" } | null;
}

export interface PortalWaterUnit {
  shareGroupId: string;
  companyId: string;
  meters: PortalMeter[];
  openRound: { id: string; readOn: string } | null;
  advance: { monthlyEur: string; startsOn: string } | null;
}

/** Portaalin vesitiedot huoneistolle: mittarit, avoin lukukierros ja voimassa oleva ennakko (osakkaalle). */
export async function portalWaterUnit(tx: Sql, shareGroupId: string, companyId: string, today: string): Promise<PortalWaterUnit | null> {
  const meters = await tx.query<{
    id: string;
    kind: MeterKind;
    meter_number: string | null;
    location: string | null;
    installed_on: string;
    start_reading: string;
  }>(
    `select id, kind, meter_number, location, installed_on::text, start_reading::text
       from er_water_meters where share_group_id = $1 and removed_on is null order by kind, installed_on`,
    [shareGroupId],
  );
  if (meters.length === 0) return null;
  const [round] = await tx.query<{ id: string; read_on: string }>(
    `select id, read_on::text from er_water_reading_rounds
      where company_id = $1 and status = 'open' and portal_open order by read_on desc limit 1`,
    [companyId],
  );
  const readings = await tx.query<{
    meter_id: string;
    reading: string;
    read_on: string;
    round_id: string;
    source: "staff" | "portal";
  }>(
    `select meter_id, reading::text, read_on::text, round_id, source from er_water_readings
      where meter_id = any($1::uuid[]) and read_on >= $2::date order by read_on desc`,
    [meters.map((m) => m.id), meters.reduce((min, m) => (m.installed_on < min ? m.installed_on : min), meters[0].installed_on)],
  );
  const [advance] = await tx.query<{ monthly_eur: string; starts_on: string }>(
    `select monthly_eur::text, starts_on::text from er_water_advances
      where share_group_id = $1 and starts_on <= $2 and (ends_on is null or ends_on >= $2) order by starts_on desc limit 1`,
    [shareGroupId, today],
  );
  return {
    shareGroupId,
    companyId,
    openRound: round ? { id: round.id, readOn: round.read_on } : null,
    advance: advance ? { monthlyEur: advance.monthly_eur, startsOn: advance.starts_on } : null,
    meters: meters.map((m) => {
      const own = readings.filter((r) => r.meter_id === m.id);
      const open = round ? own.find((r) => r.round_id === round.id) : undefined;
      const last = own.find((r) => r.round_id !== round?.id && r.read_on >= m.installed_on && (!round || r.read_on < round.read_on));
      return {
        id: m.id,
        shareGroupId,
        kind: m.kind,
        meterNumber: m.meter_number,
        location: m.location,
        lastReading: last ? { value: last.reading, on: last.read_on } : { value: m.start_reading, on: m.installed_on },
        openReading: open ? { value: open.reading, source: open.source } : null,
      };
    }),
  };
}

/**
 * Edellinen lukema tarkistusta varten: viimeisin aiemman kierroksen lukema
 * tai mittarin aloituslukema. Poistetuilla mittareilla ei ole.
 */
export async function previousReadings(tx: Sql, companyId: string, beforeDate: string): Promise<Map<string, MeterReading>> {
  const rows = await tx.query<{
    meter_id: string;
    reading: string;
    read_on: string;
  }>(
    `select m.id as meter_id,
            coalesce(x.reading, m.start_reading)::text as reading,
            coalesce(x.read_on, m.installed_on)::text as read_on
       from er_water_meters m
       left join lateral (
         select r.reading, r.read_on from er_water_readings r
          where r.meter_id = m.id and r.read_on < $2::date and r.read_on >= m.installed_on
          order by r.read_on desc limit 1
       ) x on true
      where m.company_id = $1 and m.removed_on is null`,
    [companyId, beforeDate],
  );
  return new Map(rows.map((r) => [r.meter_id, { value: r.reading, on: r.read_on }]));
}
