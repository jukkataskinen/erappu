import type { Sql } from "@/lib/db";
import { groupOwnersForVoting, type OwnershipInput } from "./attendees";
import { isGeneralMeeting, type MeetingKind } from "./labels";
import { resolveAgenda, type AgendaItemTemplate } from "./templates";

/**
 * Kokousten muutokset. Kutsujan transaktio (käyttäjän RLS), joten toisen
 * organisaation kokoukseen kohdistuva muutos ei löydä riviä.
 */

export interface NewMeeting {
  companyId: string;
  kind: MeetingKind;
  startsAt: string;
  location: string | null;
  remoteParticipation: boolean;
  remoteUrl: string | null;
  fiscalYear: string | null;
  createdBy: string;
}

export async function createMeeting(tx: Sql, m: NewMeeting): Promise<{ id: string; organizationId: string } | null> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [m.companyId]);
  if (!company) return null;
  const [row] = await tx.query<{ id: string }>(
    `insert into er_meetings (organization_id, company_id, kind, starts_at, location, remote_participation, remote_url, fiscal_year, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [company.organization_id, m.companyId, m.kind, m.startsAt, m.location, m.remoteParticipation, m.remoteUrl, m.fiscalYear, m.createdBy],
  );

  const [custom] = await tx.query<{ items: AgendaItemTemplate[] }>(
    "select items from er_agenda_templates where organization_id = $1 and kind = $2 and is_default limit 1",
    [company.organization_id, m.kind],
  );
  const items = resolveAgenda(m.kind, custom?.items);
  for (const [index, item] of items.entries()) {
    await tx.query("insert into er_meeting_items (organization_id, meeting_id, position, title, proposal) values ($1,$2,$3,$4,$5)", [
      company.organization_id, row.id, index + 1, item.title, item.proposal || null,
    ]);
  }
  return { id: row.id, organizationId: company.organization_id };
}

export async function addItem(tx: Sql, meetingId: string, title: string, proposal: string | null): Promise<boolean> {
  const rows = await tx.query(
    `insert into er_meeting_items (organization_id, meeting_id, position, title, proposal)
     select m.organization_id, m.id, coalesce((select max(position) from er_meeting_items where meeting_id = m.id), 0) + 1, $2, $3
       from er_meetings m where m.id = $1 returning id`,
    [meetingId, title, proposal],
  );
  return rows.length > 0;
}

export async function updateItem(tx: Sql, meetingId: string, itemId: string, fields: { title: string; proposal: string | null; decision: string | null }): Promise<boolean> {
  const rows = await tx.query(
    "update er_meeting_items set title = $3, proposal = $4, decision = $5 where id = $2 and meeting_id = $1 returning id",
    [meetingId, itemId, fields.title, fields.proposal, fields.decision],
  );
  return rows.length > 0;
}

/** Siirtää asiaa ylös tai alas. Uniikkiehto on viivästetty, joten vaihto onnistuu samassa transaktiossa. */
export async function moveItem(tx: Sql, meetingId: string, itemId: string, direction: "up" | "down"): Promise<boolean> {
  const items = await tx.query<{ id: string; position: number }>("select id, position from er_meeting_items where meeting_id = $1 order by position", [meetingId]);
  const index = items.findIndex((i) => i.id === itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return false;
  const a = items[index];
  const b = items[target];
  await tx.query("update er_meeting_items set position = $2 where id = $1", [a.id, b.position]);
  await tx.query("update er_meeting_items set position = $2 where id = $1", [b.id, a.position]);
  return true;
}

export async function deleteItem(tx: Sql, meetingId: string, itemId: string): Promise<boolean> {
  const rows = await tx.query("delete from er_meeting_items where id = $1 and meeting_id = $2 returning id", [itemId, meetingId]);
  if (rows.length === 0) return false;
  const rest = await tx.query<{ id: string }>("select id from er_meeting_items where meeting_id = $1 order by position", [meetingId]);
  for (const [i, r] of rest.entries()) await tx.query("update er_meeting_items set position = $2 where id = $1", [r.id, i + 1]);
  return true;
}

/**
 * Esitäyttää osallistujat: yhtiökokoukseen osakkaat osakasluettelosta,
 * hallituksen kokoukseen voimassa olevat hallituksen jäsenet. Olemassa
 * olevat rivit korvataan, joten esitäyttö tehdään ennen kokousta.
 */
export async function prefillAttendees(tx: Sql, meetingId: string): Promise<number> {
  const [meeting] = await tx.query<{ organization_id: string; company_id: string; kind: MeetingKind }>(
    "select organization_id, company_id, kind from er_meetings where id = $1",
    [meetingId],
  );
  if (!meeting) return 0;
  await tx.query("delete from er_meeting_attendees where meeting_id = $1", [meetingId]);

  if (isGeneralMeeting(meeting.kind)) {
    const owners = await tx.query<OwnershipInput>(
      `select p.id as party_id, p.display_name, g.id as share_group_id, g.unit_label, g.share_count
         from er_ownerships o
         join er_share_groups g on g.id = o.share_group_id
         join er_parties p on p.id = o.party_id
        where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= current_date)`,
      [meeting.company_id],
    );
    const drafts = groupOwnersForVoting(owners);
    for (const d of drafts) {
      await tx.query(
        `insert into er_meeting_attendees (organization_id, meeting_id, party_id, display_name, share_group_ids, shares, votes)
         values ($1,$2,$3,$4,$5,$6,$6)`,
        [meeting.organization_id, meetingId, d.partyId, d.displayName, d.shareGroupIds, d.shares],
      );
    }
    return drafts.length;
  }

  const board = await tx.query<{ party_id: string; display_name: string }>(
    `select distinct p.id as party_id, p.display_name
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role in ('chair', 'member', 'deputy') and (b.ends_on is null or b.ends_on >= current_date)
      order by p.display_name`,
    [meeting.company_id],
  );
  for (const b of board) {
    await tx.query(
      "insert into er_meeting_attendees (organization_id, meeting_id, party_id, display_name) values ($1,$2,$3,$4)",
      [meeting.organization_id, meetingId, b.party_id, b.display_name],
    );
  }
  return board.length;
}
