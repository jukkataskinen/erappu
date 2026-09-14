import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import { parseOpenHours, weeklySlots, type BusyInterval, type OpenHours, type Slot } from "./slots";

export const RECURRING_WEEKS = 12;

export interface ResourceRow {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  name: string;
  description: string | null;
  slot_minutes: number;
  open_hours: OpenHours;
  max_active_bookings_per_unit: number | null;
  allow_recurring: boolean;
  price_eur: string | null;
  active: boolean;
}

const RESOURCE_COLUMNS = `r.id, r.organization_id, r.company_id, c.name as company_name, r.name, r.description, r.slot_minutes, r.open_hours,
  r.max_active_bookings_per_unit, r.allow_recurring, r.price_eur::text as price_eur, r.active`;

const mapResource = (r: ResourceRow): ResourceRow => ({ ...r, open_hours: parseOpenHours(r.open_hours) });

/** RLS rajaa: henkilökunnalle organisaation, portaalille oman yhtiön aktiiviset. */
export async function listResources(tx: Sql, f: { organizationId?: string | null; companyId?: string | null; activeOnly?: boolean } = {}): Promise<ResourceRow[]> {
  const where = ["true"];
  const params: unknown[] = [];
  if (f.organizationId) {
    params.push(f.organizationId);
    where.push(`r.organization_id = $${params.length}`);
  }
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`r.company_id = $${params.length}`);
  }
  if (f.activeOnly) where.push("r.active");
  const rows = await tx.query<ResourceRow>(
    `select ${RESOURCE_COLUMNS} from er_bookable_resources r join er_housing_companies c on c.id = r.company_id
      where ${where.join(" and ")} order by c.name, r.name`,
    params,
  );
  return rows.map(mapResource);
}

export async function getResource(tx: Sql, id: string): Promise<ResourceRow | null> {
  const [row] = await tx.query<ResourceRow>(
    `select ${RESOURCE_COLUMNS} from er_bookable_resources r join er_housing_companies c on c.id = r.company_id where r.id = $1`,
    [id],
  );
  return row ? mapResource(row) : null;
}

/** Varatut ajat ilman varaajan tietoja (portaali ja henkilökunta). */
export async function resourceBusy(tx: Sql, resourceId: string, from: string, to: string): Promise<BusyInterval[]> {
  return tx.query<BusyInterval>(
    "select own_booking_id, starts_at, ends_at, mine from er_resource_bookings($1, $2::timestamptz, $3::timestamptz)",
    [resourceId, from, to],
  );
}

export interface StaffBookingRow {
  id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  recurring_weekly: boolean;
  series_id: string | null;
  note: string | null;
  unit_label: string | null;
  booker_name: string | null;
}

/** Henkilökunnan näkymä: kuka on varannut (huoneisto ja nimi). */
export async function listBookingsForStaff(tx: Sql, resourceId: string, from: string, to: string): Promise<StaffBookingRow[]> {
  return tx.query<StaffBookingRow>(
    `select b.id, b.starts_at, b.ends_at, b.recurring_weekly, b.series_id, b.note, g.unit_label, coalesce(u.full_name, u.email) as booker_name
       from er_bookings b
       left join er_share_groups g on g.id = b.share_group_id
       left join er_users u on u.id = b.user_id
      where b.resource_id = $1 and b.cancelled_at is null and b.starts_at < $3::timestamptz and b.ends_at > $2::timestamptz
      order by b.starts_at`,
    [resourceId, from, to],
  );
}

export interface MyBookingRow {
  id: string;
  resource_id: string;
  resource_name: string;
  company_name: string;
  starts_at: Date | string;
  ends_at: Date | string;
  recurring_weekly: boolean;
  series_id: string | null;
  unit_label: string | null;
}

export async function listMyUpcomingBookings(tx: Sql, userId: string, limit = 20): Promise<MyBookingRow[]> {
  return tx.query<MyBookingRow>(
    `select b.id, b.resource_id, r.name as resource_name, c.name as company_name, b.starts_at, b.ends_at, b.recurring_weekly, b.series_id, g.unit_label
       from er_bookings b
       join er_bookable_resources r on r.id = b.resource_id
       join er_housing_companies c on c.id = b.company_id
       left join er_share_groups g on g.id = b.share_group_id
      where b.user_id = $1 and b.cancelled_at is null and b.ends_at > now()
      order by b.starts_at limit $2`,
    [userId, limit],
  );
}

export interface CreateBookingInput {
  resource: Pick<ResourceRow, "id" | "open_hours" | "slot_minutes" | "allow_recurring">;
  slot: Slot;
  shareGroupId: string | null;
  userId: string;
  recurring: boolean;
  note?: string | null;
}

/**
 * Luo varauksen tai vakiovuoron (12 viikkoa). Vakiovuoron viikot, joille on jo
 * varaus, ohitetaan; ensimmäisen viikon päällekkäisyys kaatuu kannan
 * exclusion constraintiin, jonka kutsuja muuttaa viestiksi.
 */
export async function createBooking(tx: Sql, input: CreateBookingInput): Promise<{ created: number; skipped: number; seriesId: string }> {
  const recurring = input.recurring && input.resource.allow_recurring;
  const slots = recurring ? weeklySlots(input.slot, RECURRING_WEEKS, input.resource.open_hours, input.resource.slot_minutes) : [input.slot];
  const seriesId = randomUUID();
  let created = 0;
  let skipped = 0;
  for (const [i, s] of slots.entries()) {
    if (i > 0) {
      const busy = await resourceBusy(tx, input.resource.id, s.startsAt, s.endsAt);
      if (busy.length) {
        skipped++;
        continue;
      }
    }
    // Organisaation ja yhtiön asettaa kannan triggeri resurssin mukaan.
    await tx.query(
      `insert into er_bookings (resource_id, share_group_id, user_id, starts_at, ends_at, recurring_weekly, series_id, note, created_by)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $3)`,
      [input.resource.id, input.shareGroupId, input.userId, s.startsAt, s.endsAt, recurring, seriesId, input.note ?? null],
    );
    created++;
  }
  return { created, skipped, seriesId };
}

/**
 * Peruu varauksen tai vakiovuoron tulevat viikot. RLS ja triggeri rajaavat
 * portaalikäyttäjän omiin varauksiinsa.
 */
export async function cancelBooking(tx: Sql, input: { bookingId: string; userId: string; wholeSeries?: boolean; onlyOwn?: boolean }): Promise<{ cancelled: number; organizationId: string | null }> {
  const rows = await tx.query<{ id: string; organization_id: string }>(
    `update er_bookings b set cancelled_at = now(), cancelled_by = $2
      where b.cancelled_at is null
        and b.ends_at > now()
        and ($4::boolean is false or b.user_id = $2)
        and (b.id = $1 or ($3::boolean and b.series_id = (select x.series_id from er_bookings x where x.id = $1)
                           and b.starts_at >= (select x.starts_at from er_bookings x where x.id = $1)))
      returning b.id, b.organization_id`,
    [input.bookingId, input.userId, input.wholeSeries ?? false, input.onlyOwn ?? false],
  );
  return { cancelled: rows.length, organizationId: rows[0]?.organization_id ?? null };
}

export function bookingErrorMessage(err: unknown): string | null {
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
  const message = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
  if (code === "23P01") return "Vuoro on jo varattu. Valitse toinen aika.";
  if (message.includes("booking_quota")) return "Huoneistollasi on jo enimmäismäärä tulevia varauksia tähän kohteeseen.";
  if (message.includes("booking_in_past")) return "Mennyttä vuoroa ei voi varata.";
  if (message.includes("booking_recurring_not_allowed")) return "Tähän kohteeseen ei voi tehdä vakiovuoroa.";
  if (message.includes("booking_resource_inactive")) return "Kohde ei ole varattavissa.";
  if (message.includes("booking_share_group_required")) return "Valitse huoneisto, jonka nimissä varaat.";
  if (message.includes("row-level security")) return "Sinulla ei ole oikeutta varata tätä kohdetta.";
  return null;
}
