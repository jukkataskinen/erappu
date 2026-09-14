import type { Sql } from "@/lib/db";

/** Tiedotteiden lukukyselyt. Käyttäjän RLS-transaktiossa: kanta rajaa näkyvät rivit. */

export interface AnnouncementRow {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  title: string;
  body: string;
  audience_roles: string[];
  building_ids: string[] | null;
  channels: string[];
  status: "draft" | "published" | "archived";
  origin: "staff" | "board";
  published_at: string | null;
  valid_until: string | null;
  author_user_id: string | null;
  author_name: string | null;
  published_by_name: string | null;
  recipient_party_count: number | null;
  email_recipient_count: number | null;
  missing_email_count: number | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  select a.id, a.organization_id, a.company_id, c.name as company_name, a.title, a.body, a.audience_roles, a.building_ids,
         a.channels, a.status, a.origin, a.published_at, a.valid_until::text as valid_until, a.author_user_id, a.recipient_party_count,
         a.email_recipient_count, a.missing_email_count, a.created_at, a.updated_at,
         coalesce(au.full_name, au.email) as author_name, coalesce(pu.full_name, pu.email) as published_by_name
    from er_announcements a
    join er_housing_companies c on c.id = a.company_id
    left join er_users au on au.id = a.author_user_id
    left join er_users pu on pu.id = a.published_by`;

export interface DeliveryStats {
  queued: number;
  sent: number;
  failed: number;
  reads: number;
}

export async function listAnnouncements(
  tx: Sql,
  f: { organizationId: string; status?: string | null; companyId?: string | null; limit?: number },
): Promise<(AnnouncementRow & DeliveryStats)[]> {
  const params: unknown[] = [f.organizationId];
  let where = "a.organization_id = $1";
  if (f.status) {
    params.push(f.status);
    where += ` and a.status = $${params.length}`;
  }
  if (f.companyId) {
    params.push(f.companyId);
    where += ` and a.company_id = $${params.length}`;
  }
  params.push(Math.min(f.limit ?? 200, 500));
  return tx.query(
    `select x.*,
            (select count(*)::int from er_outbound_messages m where m.subject_table = 'er_announcements' and m.subject_id = x.id and m.status = 'queued') as queued,
            (select count(*)::int from er_outbound_messages m where m.subject_table = 'er_announcements' and m.subject_id = x.id and m.status in ('sent', 'delivered')) as sent,
            (select count(*)::int from er_outbound_messages m where m.subject_table = 'er_announcements' and m.subject_id = x.id and m.status = 'failed') as failed,
            (select count(*)::int from er_announcement_reads r where r.announcement_id = x.id) as reads
       from (${SELECT} where ${where}) x
      order by case x.status when 'draft' then 0 when 'published' then 1 else 2 end, coalesce(x.published_at, x.updated_at) desc
      limit $${params.length}`,
    params,
  );
}

export async function getAnnouncement(tx: Sql, id: string): Promise<AnnouncementRow | null> {
  const [row] = await tx.query<AnnouncementRow>(`${SELECT} where a.id = $1`, [id]);
  return row ?? null;
}

export async function deliveryStats(tx: Sql, id: string): Promise<DeliveryStats> {
  const [row] = await tx.query<DeliveryStats>(
    `select count(*) filter (where status = 'queued')::int as queued,
            count(*) filter (where status in ('sent', 'delivered'))::int as sent,
            count(*) filter (where status = 'failed')::int as failed,
            (select count(*)::int from er_announcement_reads r where r.announcement_id = $1) as reads
       from er_outbound_messages where subject_table = 'er_announcements' and subject_id = $1`,
    [id],
  );
  return row;
}

export interface PortalAnnouncementRow {
  id: string;
  company_id: string;
  company_name: string;
  title: string;
  body: string;
  status: string;
  origin: string;
  audience_roles: string[];
  published_at: string | null;
  valid_until: string | null;
  created_at: string;
  author_user_id: string | null;
  read_at: string | null;
}

/**
 * Portaalin tiedotteet: voimassa olevat julkaistut ja hallituksen luonnokset
 * käyttäjän portaaliyhtiöistä. RLS rajaa kohderyhmän; yhtiörajaus estää sen,
 * että henkilökuntaan kuuluva näkisi portaalissa koko organisaation tiedotteet.
 */
export async function listPortalAnnouncements(
  tx: Sql,
  userId: string,
  companyIds: string[],
  opts: { unreadOnly?: boolean; limit?: number; boardCompanyIds?: string[] } = {},
): Promise<PortalAnnouncementRow[]> {
  return tx.query<PortalAnnouncementRow>(
    `select a.id, a.company_id, c.name as company_name, a.title, a.body, a.status, a.origin, a.audience_roles, a.published_at,
            a.valid_until::text as valid_until, a.created_at, a.author_user_id, r.read_at
       from er_announcements a
       join er_housing_companies c on c.id = a.company_id
       left join er_announcement_reads r on r.announcement_id = a.id and r.user_id = $1
      where a.company_id = any($2::uuid[])
        and ((a.status = 'published' and (a.valid_until is null or a.valid_until >= current_date))
             or (a.status = 'draft' and a.origin = 'board' and a.company_id = any($5::uuid[])))
        and ($3::boolean is false or (r.read_at is null and a.status = 'published'))
      order by case a.status when 'draft' then 0 else 1 end, coalesce(a.published_at, a.created_at) desc
      limit $4`,
    [userId, companyIds, opts.unreadOnly ?? false, Math.min(opts.limit ?? 100, 500), opts.boardCompanyIds ?? []],
  );
}

export async function markRead(tx: Sql, announcementId: string, userId: string): Promise<void> {
  await tx.query(
    `insert into er_announcement_reads (announcement_id, user_id, organization_id)
     select a.id, $2, a.organization_id from er_announcements a where a.id = $1 and a.status = 'published'
     on conflict do nothing`,
    [announcementId, userId],
  );
}
