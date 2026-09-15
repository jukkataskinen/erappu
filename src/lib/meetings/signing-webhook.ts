import "server-only";
import { audit } from "@/lib/audit";
import { markRoundCompleted, type SubjectHandler } from "@/lib/signing/rounds";
import { meetingDocumentVisibility } from "./documents";
import { MEETING_KIND } from "./labels";

/**
 * Pöytäkirjan valmistuminen eSinetissä: sinetöity PDF dokumentteihin
 * (osakkaille tai hallitukselle) ja kokous tilaan `minutes_signed`.
 * Reititys ja idempotenssi: `src/lib/signing/process.ts`.
 */

async function loadMeeting(db: Parameters<SubjectHandler["sealedFile"]>[0], id: string) {
  const rows = await db.asService((tx) =>
    tx.query<{ kind: string; starts_at: string; company_id: string }>("select kind, starts_at, company_id from er_meetings where id = $1", [id]),
  );
  if (!rows[0]) throw new Error("Kokousta ei löytynyt.");
  return rows[0];
}

export const meetingSigningHandler: SubjectHandler = {
  subjectTable: "er_meetings",
  refKind: "meeting",

  async sealedFile(db, round) {
    const meeting = await loadMeeting(db, round.subject_id);
    const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
    return { companyId: meeting.company_id, fileName: `poytakirja-allekirjoitettu-${date}.pdf` };
  },

  async onCompleted(tx, round, event, stored) {
    const [meeting] = await tx.query<{ kind: string; starts_at: string; company_id: string }>("select kind, starts_at, company_id from er_meetings where id = $1", [round.subject_id]);
    if (!meeting) throw new Error("Kokousta ei löytynyt.");
    const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                 visibility, year, subject_table, subject_id, sealed)
       values ($1,$2,'minutes',$3,$4,$5,$6,$7,$8,$9,$10,'er_meetings',$11,true) returning id`,
      [round.organization_id, meeting.company_id,
        `Pöytäkirja (allekirjoitettu): ${MEETING_KIND[meeting.kind as keyof typeof MEETING_KIND].toLowerCase()} ${new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at))}`,
        stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256,
        meetingDocumentVisibility(meeting.kind, "minutes"), Number(date.slice(0, 4)), round.subject_id],
    );
    await markRoundCompleted(tx, round, event, doc.id);
    await tx.query("update er_meetings set status = 'minutes_signed' where id = $1 and status <> 'cancelled'", [round.subject_id]);
    await audit(tx, { organizationId: round.organization_id, userId: null, action: "minutes_signed", entity: "meeting", entityId: round.subject_id, details: { documentId: doc.id } });
  },
};
