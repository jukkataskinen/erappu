import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { queueMessage } from "@/lib/messaging";
import { generateMeetingDocument } from "./documents";
import { MeetingAttachmentPdfError } from "./attachment-pdf";
import { isGeneralMeeting, type MeetingKind } from "./labels";
import { buildNoticeMessage, splitNoticeRecipients, type NoticeParty } from "./notice";
import { listItems } from "./queries";

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

/** Kutsun vastaanottajat: yhtiökokoukseen osakkaat, hallituksen kokoukseen hallitus. */
export async function listNoticeParties(tx: Sql, companyId: string, kind: MeetingKind): Promise<NoticeParty[]> {
  if (isGeneralMeeting(kind)) {
    return tx.query<NoticeParty>(
      `select p.id as party_id, p.display_name, p.email, p.electronic_notice_consent, p.street_address, p.postal_code, p.city,
              string_agg(g.unit_label, ', ' order by length(g.unit_label), g.unit_label) as unit_labels
         from er_ownerships o
         join er_share_groups g on g.id = o.share_group_id
         join er_parties p on p.id = o.party_id
        where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= current_date)
        group by p.id
        order by p.display_name`,
      [companyId],
    );
  }
  return tx.query<NoticeParty>(
    `select p.id as party_id, p.display_name, p.email, true as electronic_notice_consent, p.street_address, p.postal_code, p.city,
            string_agg(distinct b.role, ', ') as unit_labels
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role in ('chair', 'member', 'deputy') and (b.ends_on is null or b.ends_on >= current_date)
      group by p.id
      order by p.display_name`,
    [companyId],
  );
}

export class NoticeError extends Error {}

/**
 * Lähettää kokouskutsun: PDF dokumentteihin, sähköpostit jonoon ja tila
 * `notice_sent`. Viestit ja tilamuutos samassa transaktiossa (CLAUDE.md 0.1
 * kohta 6), jotta tila ei voi muuttua ilman viestejä tai päinvastoin.
 */
export async function sendMeetingNotice(run: Runner, userId: string, meetingId: string): Promise<{ electronic: number; paper: number; documentId: string }> {
  const meeting = await run(async (tx) => {
    const [m] = await tx.query<{ id: string; organization_id: string; company_id: string; kind: MeetingKind; status: string }>(
      "select id, organization_id, company_id, kind, status from er_meetings where id = $1",
      [meetingId],
    );
    return m ?? null;
  });
  if (!meeting) throw new NoticeError("Kokousta ei löytynyt.");
  if (meeting.status !== "draft") throw new NoticeError("Kutsu on jo lähetetty.");

  const generated = await generateMeetingDocument(run, userId, meetingId, "notice").catch((err) => {
    if (err instanceof MeetingAttachmentPdfError) throw new NoticeError(err.message);
    throw err;
  });
  if (!generated) throw new NoticeError("Kokouskutsua ei voitu muodostaa.");
  // Lopullinen esityslista tallentuu kutsun kanssa; kokoussivun PDF-painikkeet ovat vain esikatselua.
  await generateMeetingDocument(run, userId, meetingId, "agenda").catch((err) => {
    if (err instanceof MeetingAttachmentPdfError) throw new NoticeError(err.message);
    throw err;
  });

  return run(async (tx) => {
    const [m] = await tx.query<{
      company_name: string; kind: MeetingKind; starts_at: string; location: string | null; remote_participation: boolean; remote_url: string | null;
      manager_name: string | null; manager_email: string | null; manager_phone: string | null;
    }>(
      `select c.name as company_name, m.kind, m.starts_at, m.location, m.remote_participation, m.remote_url,
              coalesce(u.full_name, u.email) as manager_name, u.email as manager_email, u.phone as manager_phone
         from er_meetings m join er_housing_companies c on c.id = m.company_id left join er_users u on u.id = c.manager_user_id
        where m.id = $1 and m.status = 'draft' for update of m`,
      [meetingId],
    );
    if (!m) throw new NoticeError("Kutsu on jo lähetetty.");
    const items = await listItems(tx, meetingId);
    const parties = await listNoticeParties(tx, meeting.company_id, meeting.kind);
    const { electronic, paper } = splitNoticeRecipients(parties, isGeneralMeeting(meeting.kind));
    const message = buildNoticeMessage({
      companyName: m.company_name,
      kind: m.kind,
      startsAt: m.starts_at,
      location: m.location,
      remoteParticipation: m.remote_participation,
      remoteUrl: m.remote_url,
      items: items.map((i) => ({ position: i.position, title: i.title })),
      managerName: m.manager_name,
      managerEmail: m.manager_email,
      managerPhone: m.manager_phone,
    });
    for (const p of electronic) {
      await queueMessage(tx, {
        organizationId: meeting.organization_id,
        recipient: p.email!.trim(),
        partyId: p.party_id,
        subject: message.subject,
        body: message.body,
        subjectTable: "er_meetings",
        subjectId: meetingId,
      });
    }
    await tx.query("update er_meetings set status = 'notice_sent', notice_sent_at = now() where id = $1", [meetingId]);
    await audit(tx, {
      organizationId: meeting.organization_id, userId, action: "send_notice", entity: "meeting", entityId: meetingId,
      details: { electronic: electronic.length, paper: paper.length, documentId: generated.documentId },
    });
    return { electronic: electronic.length, paper: paper.length, documentId: generated.documentId };
  });
}
