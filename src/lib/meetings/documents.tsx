/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf } from "@/documents/render";
import { Agenda } from "@/documents/Agenda";
import { MeetingNotice, type MeetingDocumentBase } from "@/documents/MeetingNotice";
import { Minutes } from "@/documents/Minutes";
import { VotingList } from "@/documents/VotingList";
import { attendanceStatement, computeVotes } from "./votes";
import { byItem, listItemAttachments } from "./attachments";
import { loadMinutesSignerPlan, type MinutesSignerPlan } from "./minutes-signers";
import { appendMeetingAttachments, type MeetingAttachmentFile } from "./attachment-pdf";
import { resolveGoverningAct, type GoverningAct } from "./governing-act";
import { isGeneralMeeting, MEETING_KIND } from "./labels";
import { getMeeting, listAttendees, listItems, type AttendeeRow, type MeetingRow } from "./queries";

/**
 * Kokouksen PDF-asiakirjat: kokouskutsu, osakasluettelo, ääniluettelo ja
 * pöytäkirja. Tiedot luetaan käyttäjän RLS-transaktiossa, PDF renderöidään
 * transaktion ulkopuolella ja dokumenttirivi kirjoitetaan omassa
 * transaktiossaan. Jos rivin kirjoitus epäonnistuu, tiedosto poistetaan.
 */

export type MeetingDocumentKind = "notice" | "agenda" | "shareholders" | "votes" | "minutes";

export const MEETING_DOCUMENT_TITLE: Record<MeetingDocumentKind, string> = {
  notice: "Kokouskutsu",
  agenda: "Esityslista",
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
  act: GoverningAct;
  /** Pykälien liitetiedostot esityslistan ja pöytäkirjan loppuun. */
  attachmentFiles: MeetingAttachmentFile[];
  /** Pöytäkirjan allekirjoittajat (hallituksen kokouksessa yhtiöjärjestyksen mukaan). */
  signerPlan: MinutesSignerPlan | null;
}

export async function loadMeetingForDocuments(tx: Sql, meetingId: string): Promise<LoadedMeeting | null> {
  const meeting = await getMeeting(tx, meetingId);
  if (!meeting) return null;
  const [company] = await tx.query<{
    name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null;
    total_shares: number | null; company_form: string; governing_act: string | null; org_name: string; manager_name: string | null; manager_email: string | null; manager_phone: string | null;
  }>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, c.total_shares, c.company_form, c.governing_act, o.name as org_name,
            coalesce(u.full_name, u.email) as manager_name, coalesce(u.contact_email, u.email) as manager_email, u.phone as manager_phone
       from er_housing_companies c
       join er_organizations o on o.id = c.organization_id
       left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [meeting.company_id],
  );
  if (!company) return null;
  const [items, attendees, attachments] = await Promise.all([listItems(tx, meetingId), listAttendees(tx, meetingId), listItemAttachments(tx, meetingId)]);
  const attachmentsByItem = byItem(attachments);
  const files = attachments.length
    ? await tx.query<{ id: string; storage_path: string; mime_type: string; size_bytes: string | number }>(
        `select a.id, d.storage_path, d.mime_type, d.size_bytes from er_meeting_item_attachments a join er_documents d on d.id = a.document_id where a.meeting_id = $1`,
        [meetingId],
      )
    : [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const attachmentFiles: MeetingAttachmentFile[] = attachments.flatMap((a) => {
    const file = fileById.get(a.id);
    const item = itemById.get(a.item_id);
    if (!file || !item) return [];
    return [{ label: a.label, title: a.title ?? "", item: `${item.position} § ${item.title}`, storagePath: file.storage_path, mimeType: file.mime_type, sizeBytes: Number(file.size_bytes) }];
  });
  const act = resolveGoverningAct(company.company_form, company.governing_act);
  const address = [company.street_address, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  return {
    meeting,
    attendees,
    totalShares: company.total_shares,
    act,
    attachmentFiles,
    signerPlan: meeting.kind === "board" ? await loadMinutesSignerPlan(tx, meetingId) : null,
    base: {
      governingAct: act,
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
      items: items.map((i) => ({
        position: i.position,
        title: i.title,
        proposal: i.proposal,
        decision: i.decision,
        attachments: (attachmentsByItem.get(i.id) ?? []).map((a) => ({ label: a.label, title: a.title ?? "" })),
      })),
      manager: company.manager_name ? { name: company.manager_name, email: company.manager_email, phone: company.manager_phone } : null,
      issuedOn: isoDateHelsinki(),
    },
  };
}

/** OYL 5:12 §: ei äänileikkuria, jollei yhtiöjärjestyksessä määrätä toisin. AOYL 6:13 §: viidesosa. */
export function buildVoteSummary(attendees: AttendeeRow[], act: GoverningAct = "aoyl") {
  return computeVotes(
    attendees.map((a) => ({ id: a.id, shares: a.shares, present: a.present })),
    act === "oyl" ? { capFraction: null } : {},
  );
}

export async function renderMeetingDocument(loaded: LoadedMeeting, kind: MeetingDocumentKind) {
  const { base, attendees, meeting } = loaded;
  if (kind === "agenda") {
    return renderDocumentPdf(<Agenda data={base} />);
  }
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
    const summary = buildVoteSummary(attendees, loaded.act);
    const voteById = new Map(summary.voters.map((v) => [v.id, v]));
    const present = attendees.filter((a) => a.present);
    const fi = (n: number) => n.toLocaleString("fi-FI").replace(/\u00a0/g, " ");
    return renderDocumentPdf(
      <Minutes
        data={{
          ...base,
          chairName: meeting.chair_name,
          secretaryName: meeting.secretary_name,
          checkerNames: (meeting.minutes_checkers ?? []).map((c) => c.name).filter(Boolean),
          signatories: loaded.signerPlan?.signers.map((s) => ({ role: s.role, name: s.name })),
          attendance: {
            presentCount: attendees.filter((a) => a.present).length,
            representedShares: summary.representedShares,
            totalVotes: summary.totalVotes,
            totalShares: loaded.totalShares,
            names: present.map((a) => a.display_name),
            statement: isGeneralMeeting(meeting.kind)
              ? attendanceStatement({
                  presentCount: present.length,
                  representedShares: summary.representedShares,
                  representedVotes: summary.representedVotes,
                  votesAfterCap: summary.totalVotes,
                  cap: summary.cap,
                  capped: summary.voters.some((v) => v.capped),
                  totalShares: loaded.totalShares,
                })
              : null,
            rows: present.map((a) => ({
              name: a.display_name,
              units: a.unit_labels ?? "",
              proxy: a.proxy_name ?? "",
              shares: fi(a.shares),
              votes: fi(voteById.get(a.id)?.votes ?? 0),
            })),
            totals: { shares: fi(summary.representedShares), votes: fi(summary.totalVotes) },
          },
        }}
      />,
    );
  }
  const summary = buildVoteSummary(attendees, loaded.act);
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
  return (kind === "notice" || kind === "agenda" || kind === "minutes") && isGeneralMeeting(meetingKind) ? "owners" : "board";
}

const FILE_PREFIX: Record<MeetingDocumentKind, string> = {
  notice: "kokouskutsu",
  agenda: "esityslista",
  shareholders: "osakasluettelo",
  votes: "aaniluettelo",
  minutes: "poytakirja",
};

/**
 * Muodostaa asiakirjan PDF:n liitteineen tallentamatta sitä. Käytetään sekä
 * esikatseluun (kokoussivun PDF-painikkeet) että lopullisen asiakirjan
 * tallennukseen (kutsun lähetys, pöytäkirjan allekirjoitus).
 */
export async function buildMeetingPdf(run: Runner, meetingId: string, kind: MeetingDocumentKind): Promise<{ bytes: Uint8Array; fileName: string; loaded: LoadedMeeting } | null> {
  const loaded = await run((tx) => loadMeetingForDocuments(tx, meetingId));
  if (!loaded) return null;
  const { meeting } = loaded;
  if (kind !== "notice" && kind !== "agenda" && kind !== "minutes" && !isGeneralMeeting(meeting.kind)) return null;

  const rendered = await renderMeetingDocument(loaded, kind);
  const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
  const pdf =
    kind === "notice" || kind === "agenda" || kind === "minutes"
      ? {
          bytes: await appendMeetingAttachments({
            document: rendered.bytes,
            files: loaded.attachmentFiles,
            documentLabel: kind === "notice" ? "KOKOUSKUTSUN LIITE" : kind === "agenda" ? "ESITYSLISTAN LIITE" : "PÖYTÄKIRJAN LIITE",
            companyName: loaded.base.companyName,
            meetingTitle: `${MEETING_KIND[meeting.kind]} ${new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at))}`,
            issuedOn: loaded.base.issuedOn,
          }),
        }
      : rendered;
  return { bytes: pdf.bytes, fileName: `${FILE_PREFIX[kind]}-${date}.pdf`, loaded };
}

/** Luo lopullisen asiakirjan, tallentaa sen ja palauttaa dokumentin id:n. */
export async function generateMeetingDocument(run: Runner, userId: string, meetingId: string, kind: MeetingDocumentKind): Promise<{ documentId: string; bytes: Uint8Array } | null> {
  const built = await buildMeetingPdf(run, meetingId, kind);
  if (!built) return null;
  const { meeting } = built.loaded;
  const pdf = { bytes: built.bytes };
  const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
  const stored = await storeFile({
    organizationId: meeting.organization_id,
    companyId: meeting.company_id,
    fileName: built.fileName,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
  });

  // Kutsu osakkaille yhtiökokouksessa, muuten hallitukselle. Osakas- ja
  // ääniluettelossa on osakkaiden nimet, joten ne ovat hallituksen.
  // Allekirjoittamaton pöytäkirja on sisäinen: vasta sinetöity versio
  // julkaistaan portaaliin (ks. signing.ts).
  const visibility = kind === "minutes" ? "internal" : meetingDocumentVisibility(meeting.kind, kind);
  const category = kind === "notice" || kind === "agenda" ? "meeting_notice" : "minutes";
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
