import type { Sql } from "@/lib/db";
import type { MeetingKind, MeetingStatus } from "./labels";

/**
 * Kokousten lukukyselyt. Ajetaan käyttäjän RLS-transaktiossa: henkilökunta
 * näkee oman organisaationsa, hallitus yhtiönsä kokoukset ja osakas
 * yhtiökokoukset kutsun lähettämisen jälkeen (0050_meetings_certificates.sql).
 */

export interface MeetingRow {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  kind: MeetingKind;
  starts_at: string;
  location: string | null;
  remote_participation: boolean;
  remote_url: string | null;
  fiscal_year: string | null;
  status: MeetingStatus;
  notice_sent_at: string | null;
  chair_name: string | null;
  chair_email: string | null;
  secretary_name: string | null;
  minutes_checkers: { name: string; email: string }[];
  notes: string | null;
  created_at: string;
}

const MEETING_COLUMNS = `m.id, m.organization_id, m.company_id, c.name as company_name, m.kind, m.starts_at, m.location, m.remote_participation,
  m.remote_url, m.fiscal_year, m.status, m.notice_sent_at, m.chair_name, m.chair_email, m.secretary_name, m.minutes_checkers, m.notes, m.created_at`;

export async function listMeetings(
  tx: Sql,
  opts: { organizationId?: string; companyId?: string; scope?: "upcoming" | "past" | "all"; limit?: number } = {},
): Promise<MeetingRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.organizationId) {
    params.push(opts.organizationId);
    where.push(`m.organization_id = $${params.length}`);
  }
  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`m.company_id = $${params.length}`);
  }
  // Kokous on "tuleva" koko kokouspäivän ajan, jotta illan kokous ei siirry
  // pidettyihin iltapäivällä.
  if (opts.scope === "upcoming") where.push("m.starts_at >= date_trunc('day', now()) and m.status in ('draft', 'notice_sent')");
  if (opts.scope === "past") where.push("(m.starts_at < date_trunc('day', now()) or m.status in ('held', 'minutes_signed', 'cancelled'))");
  params.push(opts.limit ?? 200);
  const order = opts.scope === "upcoming" ? "m.starts_at asc" : "m.starts_at desc";
  return tx.query<MeetingRow>(
    `select ${MEETING_COLUMNS}
       from er_meetings m join er_housing_companies c on c.id = m.company_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by ${order} limit $${params.length}`,
    params,
  );
}

export async function getMeeting(tx: Sql, id: string): Promise<MeetingRow | null> {
  const [row] = await tx.query<MeetingRow>(
    `select ${MEETING_COLUMNS} from er_meetings m join er_housing_companies c on c.id = m.company_id where m.id = $1`,
    [id],
  );
  return row ?? null;
}

export interface MeetingItemRow {
  id: string;
  position: number;
  title: string;
  proposal: string | null;
  decision: string | null;
}

export async function listItems(tx: Sql, meetingId: string): Promise<MeetingItemRow[]> {
  return tx.query<MeetingItemRow>("select id, position, title, proposal, decision from er_meeting_items where meeting_id = $1 order by position", [meetingId]);
}

export interface AttendeeRow {
  id: string;
  party_id: string | null;
  represented_party_id: string | null;
  display_name: string;
  proxy_name: string | null;
  share_group_ids: string[];
  unit_labels: string | null;
  shares: number;
  votes: number;
  present: boolean;
  remote: boolean;
  proxy_document_id: string | null;
}

export async function listAttendees(tx: Sql, meetingId: string): Promise<AttendeeRow[]> {
  return tx.query<AttendeeRow>(
    `select a.id, a.party_id, a.represented_party_id, a.display_name, a.proxy_name, a.share_group_ids, a.shares, a.votes, a.present, a.remote,
            a.proxy_document_id,
            (select string_agg(g.unit_label, ', ' order by length(g.unit_label), g.unit_label)
               from er_share_groups g where g.id = any(a.share_group_ids)) as unit_labels
       from er_meeting_attendees a
      where a.meeting_id = $1
      order by a.display_name`,
    [meetingId],
  );
}

export interface MeetingDocumentRow {
  id: string;
  title: string;
  category: string;
  visibility: string;
  sealed: boolean;
  created_at: string;
}

export async function listMeetingDocuments(tx: Sql, meetingId: string): Promise<MeetingDocumentRow[]> {
  return tx.query<MeetingDocumentRow>(
    `select id, title, category, visibility, sealed, created_at from er_documents
      where subject_table = 'er_meetings' and subject_id = $1 order by created_at desc`,
    [meetingId],
  );
}

export interface SigningRoundRow {
  id: string;
  esinetti_round_id: string | null;
  status: string;
  signers: { name: string; email: string; role: string; status?: string; signedAt?: string | null }[];
  original_document_id: string | null;
  sealed_document_id: string | null;
  last_event: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function listSigningRounds(tx: Sql, subjectTable: string, subjectId: string): Promise<SigningRoundRow[]> {
  return tx.query<SigningRoundRow>(
    `select id, esinetti_round_id, status, signers, original_document_id, sealed_document_id, last_event, completed_at, created_at
       from er_signing_rounds where subject_table = $1 and subject_id = $2 order by created_at desc`,
    [subjectTable, subjectId],
  );
}

export interface PendingSignatureRow {
  meeting_id: string;
  company_id: string;
  company_name: string;
  kind: MeetingKind;
  starts_at: string;
  status: string;
  created_at: string;
}

export async function listPendingSignatures(tx: Sql, organizationId: string): Promise<PendingSignatureRow[]> {
  return tx.query<PendingSignatureRow>(
    `select m.id as meeting_id, m.company_id, c.name as company_name, m.kind, m.starts_at, r.status, r.created_at
       from er_signing_rounds r
       join er_meetings m on m.id = r.subject_id and r.subject_table = 'er_meetings'
       join er_housing_companies c on c.id = m.company_id
      where r.organization_id = $1 and r.status in ('draft', 'sent', 'partially_signed')
      order by r.created_at`,
    [organizationId],
  );
}
