/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf } from "@/documents/render";
import { MeetingNotice, type MeetingDocumentBase } from "@/documents/MeetingNotice";
import { Minutes } from "@/documents/Minutes";
import { VotingList } from "@/documents/VotingList";
import { computeVotes } from "./votes";
import { isGeneralMeeting, MEETING_KIND } from "./labels";
import { getMeeting, listAttendees, listItems, type AttendeeRow, type MeetingRow } from "./queries";

/**
 * Kokouksen PDF-asiakirjat: kokouskutsu, osakasluettelo, ääniluettelo ja
 * pöytäkirja. Tiedot luetaan käyttäjän RLS-transaktiossa, PDF renderöidään
 * transaktion ulkopuolella ja dokumenttirivi kirjoitetaan omassa
 * transaktiossaan. Jos rivin kirjoitus epäonnistuu, tiedosto poistetaan.
 */

export type MeetingDocumentKind = "notice" | "shareholders" | "votes" | "minutes";

export const MEETING_DOCUMENT_TITLE: Record<MeetingDocumentKind, string> = {
  notice: "Kokouskutsu",
  shareholders: "Osakasluettelo",
  votes: "Ääniluettelo",
  minutes: "Pöytäkirja",
};

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

interface LoadedMeeting {
  meeting: MeetingRow;
  base: MeetingDocumentBase;
  attendees: AttendeeRow[];
  totalShares: number | null;
}

export async function loadMeetingForDocuments(tx: Sql, meetingId: string): Promise<LoadedMeeting | null> {
  const meeting = await getMeeting(tx, meetingId);
  if (!meeting) return null;
  const [company] = await tx.query<{
    name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null;
    total_shares: number | null; org_name: string; manager_name: string | null; manager_email: string | null; manager_phone: string | null;
  }>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, c.total_shares, o.name as org_name,
            coalesce(u.full_name, u.email) as manager_name, u.email as manager_email, u.phone as manager_phone
       from er_housing_companies c
       join er_organizations o on o.id = c.organization_id
       left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [meeting.company_id],
  );
  if (!company) return null;
  const [items, attendees] = await Promise.all([listItems(tx, meetingId), listAttendees(tx, meetingId)]);
  const address = [company.street_address, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  return {
    meeting,
    attendees,
    totalShares: company.total_shares,
    base: {
      organizationName: company.org_name,
      companyName: company.name,
      companyBusinessId: company.business_id,
      companyAddress: address,
      kind: meeting.kind,
      startsAt: new Date(meeting.starts_at).toISOString(),
      location: meeting.location,
      remoteParticipation: meeting.remote_participation,
      remoteUrl: meeting.remote_url,
      fiscalYear: meeting.fiscal_year,
      items: items.map((i) => ({ position: i.position, title: i.title, proposal: i.proposal, decision: i.decision })),
      manager: company.manager_name ? { name: company.manager_name, email: company.manager_email, phone: company.manager_phone } : null,
      issuedOn: isoDateHelsinki(),
    },
  };
}

export function buildVoteSummary(attendees: AttendeeRow[]) {
  return computeVotes(attendees.map((a) => ({ id: a.id, shares: a.shares, present: a.present })));
}

export async function renderMeetingDocument(loaded: LoadedMeeting, kind: MeetingDocumentKind) {
  const { base, attendees, meeting } = loaded;
  if (kind === "notice") {
    return renderDocumentPdf(
      <MeetingNotice
        data={{
          ...base,
          attachmentsNote: isGeneralMeeting(meeting.kind)
            ? "Tilinpäätös, toimintakertomus ja muut kokouksessa käsiteltävät asiakirjat ovat osakkaiden nähtävillä portaalissa ja isännöitsijältä vähintään viikkoa ennen kokousta."
            : null,
        }}
      />,
    );
  }
  if (kind === "minutes") {
    const summary = buildVoteSummary(attendees);
    return renderDocumentPdf(
      <Minutes
        data={{
          ...base,
          chairName: meeting.chair_name,
          secretaryName: meeting.secretary_name,
          checkerNames: (meeting.minutes_checkers ?? []).map((c) => c.name).filter(Boolean),
          attendance: {
            presentCount: attendees.filter((a) => a.present).length,
            representedShares: summary.representedShares,
            totalVotes: summary.totalVotes,
            totalShares: loaded.totalShares,
            names: attendees.filter((a) => a.present).map((a) => a.display_name),
          },
        }}
      />,
    );
  }
  const summary = buildVoteSummary(attendees);
  const byId = new Map(summary.voters.map((v) => [v.id, v]));
  return renderDocumentPdf(
    <VotingList
      data={{
        mode: kind === "votes" ? "votes" : "shareholders",
        organizationName: base.organizationName,
        companyName: base.companyName,
        meetingTitle: MEETING_KIND[meeting.kind],
        startsAt: base.startsAt,
        issuedOn: base.issuedOn,
        rows: attendees.map((a) => {
          const v = byId.get(a.id)!;
          return {
            name: a.display_name,
            proxyName: a.proxy_name,
            units: a.unit_labels ?? "",
            shares: a.shares,
            fullVotes: v.fullVotes,
            votes: v.votes,
            present: a.present,
            remote: a.remote,
            capped: v.capped,
          };
        }),
        totalShares: loaded.totalShares,
        representedShares: summary.representedShares,
        representedVotes: summary.representedVotes,
        totalVotes: summary.totalVotes,
        cap: summary.cap,
      }}
    />,
  );
}

export function meetingDocumentVisibility(meetingKind: string, kind: MeetingDocumentKind): "owners" | "board" {
  return (kind === "notice" || kind === "minutes") && isGeneralMeeting(meetingKind) ? "owners" : "board";
}

const FILE_PREFIX: Record<MeetingDocumentKind, string> = {
  notice: "kokouskutsu",
  shareholders: "osakasluettelo",
  votes: "aaniluettelo",
  minutes: "poytakirja",
};

/** Luo asiakirjan, tallentaa sen ja palauttaa dokumentin id:n. */
export async function generateMeetingDocument(run: Runner, userId: string, meetingId: string, kind: MeetingDocumentKind): Promise<{ documentId: string; bytes: Uint8Array } | null> {
  const loaded = await run((tx) => loadMeetingForDocuments(tx, meetingId));
  if (!loaded) return null;
  const { meeting } = loaded;
  if (kind !== "notice" && kind !== "minutes" && !isGeneralMeeting(meeting.kind)) return null;

  const pdf = await renderMeetingDocument(loaded, kind);
  const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
  const stored = await storeFile({
    organizationId: meeting.organization_id,
    companyId: meeting.company_id,
    fileName: `${FILE_PREFIX[kind]}-${date}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
  });

  // Kutsu osakkaille yhtiökokouksessa, muuten hallitukselle. Osakas- ja
  // ääniluettelossa on osakkaiden nimet, joten ne ovat hallituksen.
  // Allekirjoittamaton pöytäkirja on sisäinen: vasta sinetöity versio
  // julkaistaan portaaliin (ks. signing.ts).
  const visibility = kind === "minutes" ? "internal" : meetingDocumentVisibility(meeting.kind, kind);
  const category = kind === "notice" ? "meeting_notice" : "minutes";
  const title = `${MEETING_DOCUMENT_TITLE[kind]}: ${MEETING_KIND[meeting.kind].toLowerCase()} ${new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at))}`;

  try {
    const documentId = await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                   visibility, year, subject_table, subject_id, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'er_meetings',$12,$13) returning id`,
        [meeting.organization_id, meeting.company_id, category, title, stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes,
          stored.sha256, visibility, Number(date.slice(0, 4)), meetingId, userId],
      );
      await audit(tx, { organizationId: meeting.organization_id, userId, action: "generate_document", entity: "meeting", entityId: meetingId, details: { kind, documentId: doc.id } });
      return doc.id;
    });
    return { documentId, bytes: pdf.bytes };
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}
