import type { Sql } from "@/lib/db";
import type { ContactStatus, ContactTopic } from "./labels";

/** Yhteydenottojen luku. Ajetaan käyttäjän RLS-transaktiossa (0095). */

export interface ThreadRow {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  share_group_id: string | null;
  unit_label: string | null;
  created_by_user_id: string;
  creator_name: string | null;
  topic: ContactTopic;
  subject: string;
  status: ContactStatus;
  last_message_at: string;
  created_at: string;
  message_count: number;
  attachment_count: number;
}

// Kysyjän nimi osapuolirekisteristä: henkilökunta ei näe portaalikäyttäjän
// käyttäjäriviä (0001 näyttää vain oman organisaation jäsenet), mutta näkee
// organisaationsa osapuolet. Portaalikäyttäjä näkee oman käyttäjärivinsä.
const PARTY_NAME = (userColumn: string, orgColumn: string) =>
  `(select p.display_name from er_parties p where p.user_id = ${userColumn} and p.organization_id = ${orgColumn} order by p.created_at limit 1)`;

const SELECT = `
  select t.id, t.organization_id, t.company_id, c.name as company_name, t.share_group_id, g.unit_label, t.created_by_user_id,
         coalesce(${PARTY_NAME("t.created_by_user_id", "t.organization_id")}, u.full_name, u.email) as creator_name,
         t.topic, t.subject, t.status, t.last_message_at, t.created_at,
         (select count(*)::int from er_contact_messages m where m.thread_id = t.id) as message_count,
         (select count(*)::int from er_documents d where d.subject_table = 'er_contact_threads' and d.subject_id = t.id) as attachment_count
    from er_contact_threads t
    join er_housing_companies c on c.id = t.company_id
    left join er_share_groups g on g.id = t.share_group_id
    left join er_users u on u.id = t.created_by_user_id`;

export async function listPortalThreads(tx: Sql, userId: string): Promise<ThreadRow[]> {
  return tx.query<ThreadRow>(`${SELECT} where t.created_by_user_id = $1 order by t.last_message_at desc`, [userId]);
}

export type StaffThreadFilter = ContactStatus | "active" | "all";

export async function listStaffThreads(tx: Sql, organizationId: string, opts: { status?: StaffThreadFilter; companyId?: string } = {}): Promise<ThreadRow[]> {
  return tx.query<ThreadRow>(
    `${SELECT}
      where t.organization_id = $1
        and ($2::uuid is null or t.company_id = $2::uuid)
        and (case $3 when 'all' then true when 'active' then t.status <> 'closed' else t.status = $3 end)
      order by case t.status when 'open' then 0 when 'answered' then 1 else 2 end, t.last_message_at desc
      limit 200`,
    [organizationId, opts.companyId ?? null, opts.status ?? "active"],
  );
}

export async function countOpenThreads(tx: Sql, organizationId: string): Promise<number> {
  const [row] = await tx.query<{ n: number }>("select count(*)::int as n from er_contact_threads where organization_id = $1 and status = 'open'", [organizationId]);
  return row?.n ?? 0;
}

export async function getThread(tx: Sql, id: string): Promise<ThreadRow | null> {
  const [row] = await tx.query<ThreadRow>(`${SELECT} where t.id = $1`, [id]);
  return row ?? null;
}

/** Ketjun tapahtumat aikajärjestyksessä: viestit ja liitteet. */
export type ThreadEntry =
  | { type: "message"; id: string; at: string; fromStaff: boolean; authorName: string | null; body: string }
  | { type: "attachment"; id: string; at: string; fromStaff: boolean; authorName: string | null; fileName: string; mimeType: string };

export function mergeEntries(
  messages: { id: string; created_at: string; from_staff: boolean; author_name: string | null; body: string }[],
  attachments: { id: string; created_at: string; uploaded_by: string | null; author_name: string | null; file_name: string; mime_type: string }[],
  creatorUserId: string,
): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...messages.map((m) => ({ type: "message" as const, id: m.id, at: String(m.created_at), fromStaff: m.from_staff, authorName: m.author_name, body: m.body })),
    ...attachments.map((a) => ({
      type: "attachment" as const,
      id: a.id,
      at: String(a.created_at),
      fromStaff: a.uploaded_by !== creatorUserId,
      authorName: a.author_name,
      fileName: a.file_name,
      mimeType: a.mime_type,
    })),
  ];
  // Sama hetki: viesti ennen sen liitteitä.
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || (a.type === b.type ? 0 : a.type === "message" ? -1 : 1));
}

export async function listThreadEntries(tx: Sql, threadId: string, creatorUserId: string): Promise<ThreadEntry[]> {
  const messages = await tx.query<{ id: string; created_at: string; from_staff: boolean; author_name: string | null; body: string }>(
    `select m.id, m.created_at, m.from_staff,
            case when m.from_staff then coalesce(u.full_name, u.email) else coalesce(${PARTY_NAME("m.author_user_id", "m.organization_id")}, u.full_name, u.email) end as author_name,
            m.body
       from er_contact_messages m left join er_users u on u.id = m.author_user_id
      where m.thread_id = $1 order by m.created_at, m.id`,
    [threadId],
  );
  const attachments = await tx.query<{ id: string; created_at: string; uploaded_by: string | null; author_name: string | null; file_name: string; mime_type: string }>(
    `select d.id, d.created_at, d.uploaded_by, coalesce(u.full_name, u.email, ${PARTY_NAME("d.uploaded_by", "d.organization_id")}) as author_name, d.file_name, d.mime_type
       from er_documents d left join er_users u on u.id = d.uploaded_by
      where d.subject_table = 'er_contact_threads' and d.subject_id = $1 order by d.created_at, d.id`,
    [threadId],
  );
  return mergeEntries(messages, attachments, creatorUserId);
}
