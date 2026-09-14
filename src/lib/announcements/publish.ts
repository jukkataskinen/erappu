import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { queueMessage } from "@/lib/messaging";
import { composeAnnouncementEmail } from "./content";
import { resolveRecipients } from "./recipients";

export interface PublishReport {
  partyCount: number;
  queued: number;
  withoutEmailCount: number;
  portalUserCount: number;
}

export type PublishResult = { ok: true; report: PublishReport } | { ok: false; reason: "not_found" | "not_draft" };

/**
 * Julkaisee luonnoksen ja kirjaa sähköpostit jonoon samassa transaktiossa.
 * Jos jonoon kirjaus kaatuu, tiedote jää luonnokseksi. Tapahtumalokiin vain
 * määrät, ei vastaanottajia.
 */
export async function publishAnnouncement(
  tx: Sql,
  opts: { id: string; userId: string; appBaseUrl?: string | null },
): Promise<PublishResult> {
  const [a] = await tx.query<{
    id: string; organization_id: string; company_id: string; company_name: string; title: string; body: string;
    audience_roles: string[]; building_ids: string[] | null; channels: string[]; status: string; valid_until: string | null;
  }>(
    `select a.id, a.organization_id, a.company_id, c.name as company_name, a.title, a.body, a.audience_roles, a.building_ids,
            a.channels, a.status, a.valid_until::text as valid_until
       from er_announcements a join er_housing_companies c on c.id = a.company_id
      where a.id = $1 for update of a`,
    [opts.id],
  );
  if (!a) return { ok: false, reason: "not_found" };
  if (a.status !== "draft") return { ok: false, reason: "not_draft" };

  const recipients = await resolveRecipients(tx, { companyId: a.company_id, audienceRoles: a.audience_roles, buildingIds: a.building_ids });
  const sendEmail = a.channels.includes("email");
  const portalUrl = opts.appBaseUrl ? `${opts.appBaseUrl.replace(/\/$/, "")}/portaali/tiedotteet/${a.id}` : null;
  const mail = composeAnnouncementEmail({ companyName: a.company_name, title: a.title, body: a.body, validUntil: a.valid_until, portalUrl });

  let queued = 0;
  if (sendEmail) {
    for (const r of recipients.emailRecipients) {
      await queueMessage(tx, {
        organizationId: a.organization_id,
        channel: "email",
        recipient: r.email,
        partyId: r.partyId,
        subject: mail.subject,
        body: mail.body,
        subjectTable: "er_announcements",
        subjectId: a.id,
      });
      queued++;
    }
  }

  const updated = await tx.query(
    `update er_announcements
        set status = 'published', published_at = now(), published_by = $2,
            recipient_party_count = $3, email_recipient_count = $4, missing_email_count = $5
      where id = $1 and status = 'draft' returning id`,
    [a.id, opts.userId, recipients.partyCount, sendEmail ? queued : 0, sendEmail ? recipients.withoutEmailCount : 0],
  );
  if (updated.length === 0) return { ok: false, reason: "not_found" };

  const report: PublishReport = {
    partyCount: recipients.partyCount,
    queued,
    withoutEmailCount: sendEmail ? recipients.withoutEmailCount : 0,
    portalUserCount: recipients.portalUserCount,
  };
  await audit(tx, {
    organizationId: a.organization_id, userId: opts.userId, action: "publish", entity: "announcement", entityId: a.id,
    details: { ...report, channels: a.channels },
  });
  return { ok: true, report };
}
