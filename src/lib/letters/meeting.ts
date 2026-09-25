import "server-only";
import type { Sql } from "@/lib/db";
import { formatDateTime, isoDateHelsinki } from "@/lib/format";
import { isGeneralMeeting, MEETING_KIND, type MeetingKind } from "@/lib/meetings/labels";
import { splitNoticeRecipients, type NoticeParty } from "@/lib/meetings/notice";
import { listNoticeParties } from "@/lib/meetings/send-notice";
import { readStoredFile } from "@/lib/storage";
import { postalAddressLines } from "./address";
import { LetterError, listActiveLetters, listLetterJobs, type LetterJobRow, type LetterRecipientRow, type LetterRow, type LetterSource, type Runner } from "./jobs";
import { SAMPLE_RECIPIENT } from "./sample";
import { loadLetterSender, MISSING_SENDER_ADDRESS, type LetterSender } from "./sender";

/**
 * Kokouskutsu paperikirjeenä niille, joille sähköinen kutsu ei käy
 * (`splitNoticeRecipients`). Kirje on ikkunakirjeen etusivu ja sen perässä
 * lähetetty kokouskutsu liitteineen sellaisenaan: juridisesti hyväksytty
 * kutsu (BLOCKERS 4) ei muutu, ja paperikutsu on sama asiakirja kuin
 * portaalissa.
 */

export interface PaperRecipient {
  party: NoticeParty;
  addressLines: string[] | null;
  letter: LetterRow | null;
}

export interface MeetingLetterPlan {
  meeting: { id: string; organization_id: string; company_id: string; kind: MeetingKind; status: string; starts_at: string; location: string | null };
  sender: LetterSender;
  paper: PaperRecipient[];
  /** Kirjeen saavat, joilla on osoite eikä vielä kirjettä. */
  ready: LetterRecipientRow[];
  jobs: LetterJobRow[];
  noticeDocument: { id: string; storage_path: string } | null;
  /** Syy, miksi kirjeitä ei voi nyt ladata; null, jos voi. */
  blocker: string | null;
}

const KIND_ILLATIVE: Record<MeetingKind, string> = {
  annual_general: "varsinaiseen yhtiökokoukseen",
  extraordinary_general: "ylimääräiseen yhtiökokoukseen",
  board: "hallituksen kokoukseen",
};

export async function planMeetingLetters(tx: Sql, meetingId: string): Promise<MeetingLetterPlan | null> {
  const [meeting] = await tx.query<MeetingLetterPlan["meeting"]>(
    "select id, organization_id, company_id, kind, status, starts_at, location from er_meetings where id = $1",
    [meetingId],
  );
  if (!meeting) return null;
  const [sender, parties, active, jobs, docs] = await Promise.all([
    loadLetterSender(tx, meeting.company_id),
    listNoticeParties(tx, meeting.company_id, meeting.kind),
    listActiveLetters(tx, "er_meetings", meetingId),
    listLetterJobs(tx, "er_meetings", meetingId),
    // Lähetetty kutsu (send-notice.ts); uusin, jos kutsu on muodostettu uudelleen.
    tx.query<{ id: string; storage_path: string }>(
      `select id, storage_path from er_documents
        where subject_table = 'er_meetings' and subject_id = $1 and category = 'meeting_notice' and file_name like 'kokouskutsu-%'
        order by created_at desc limit 1`,
      [meetingId],
    ),
  ]);
  if (!sender) return null;
  const general = isGeneralMeeting(meeting.kind);
  const byParty = new Map(active.map((l) => [l.party_id, l]));
  const paper = splitNoticeRecipients(parties, general).paper.map((party) => ({
    party,
    addressLines: postalAddressLines(party),
    letter: byParty.get(party.party_id) ?? null,
  }));
  const ready = paper
    .filter((p) => p.addressLines && !p.letter)
    .map((p) => ({
      partyId: p.party.party_id,
      name: p.party.display_name,
      addressLines: p.addressLines!,
      reference: general && p.party.unit_labels ? `Kohde: ${p.party.unit_labels}` : null,
    }));
  const noticeDocument = docs[0] ?? null;

  let blocker: string | null = null;
  if (meeting.status !== "notice_sent") blocker = "Kirjeet lähetetään, kun kokouskutsu on lähetetty ja ennen kuin kokous on pidetty.";
  else if (!noticeDocument) blocker = "Lähetettyä kokouskutsua ei löytynyt dokumenteista.";
  else if (!sender.lines) blocker = MISSING_SENDER_ADDRESS;
  else if (jobs.some((j) => j.status === "NE" || j.status === "uploading")) blocker = "Edellinen kirjetyö odottaa vahvistusta.";
  else if (ready.length === 0) blocker = "Ei lähetettäviä kirjeitä.";
  return { meeting, sender, paper, ready, jobs, noticeDocument, blocker };
}

function meetingContent(plan: MeetingLetterPlan) {
  const { meeting, sender } = plan;
  const general = isGeneralMeeting(meeting.kind);
  const when = `${formatDateTime(meeting.starts_at)}${meeting.location ? `, ${meeting.location}` : ""}`;
  const paragraphs = [
    `${general ? sender.companyName + " kutsuu sinut" : "Sinut kutsutaan"} ${KIND_ILLATIVE[meeting.kind]} ${when}. Kokouskutsu${general ? " ja valtakirjapohja ovat" : " on"} tämän kirjeen liitteenä.`,
  ];
  if (general) {
    paragraphs.push(
      "Saat kutsun paperisena, koska meillä ei ole sähköpostiosoitettasi tai suostumustasi sähköiseen kokouskutsuun. Jos haluat jatkossa kutsut sähköpostiin, ilmoita osoitteesi ja suostumuksesi isännöitsijälle.",
    );
  }
  const manager = sender.manager;
  return {
    title: `Kutsu: ${MEETING_KIND[meeting.kind].toLowerCase()}`,
    paragraphs,
    signature: [
      ...(general ? ["Hallituksen puolesta", manager.name ? `Isännöitsijä ${manager.name}` : ""] : [manager.name ?? "Isännöitsijä"]),
      [manager.phone, manager.email].filter(Boolean).join(", "),
    ].filter(Boolean),
    footer: `${sender.organizationName} · ${sender.companyName}`,
  };
}

/** Kirjetyön lähde: suunnitelma, kutsun PDF ja kirjeen teksti. */
export async function loadMeetingLetterSource(run: Runner, meetingId: string): Promise<LetterSource> {
  const plan = await run((tx) => planMeetingLetters(tx, meetingId));
  if (!plan) throw new LetterError("Kokousta ei löytynyt.");
  if (plan.blocker) throw new LetterError(plan.blocker);
  const appendix = new Uint8Array(await readStoredFile(plan.noticeDocument!.storage_path));
  return {
    organizationId: plan.meeting.organization_id,
    companyId: plan.meeting.company_id,
    subjectTable: "er_meetings",
    subjectId: meetingId,
    jobName: `${plan.sender.companyName}: ${MEETING_KIND[plan.meeting.kind].toLowerCase()} ${new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(plan.meeting.starts_at))}`.slice(0, 200),
    sender: plan.sender.lines!,
    date: isoDateHelsinki(),
    content: meetingContent(plan),
    appendix,
    recipients: plan.ready,
  };
}

/**
 * Esikatselu ja koetuloste ilman latausta. Koetulosteessa on kuvitteellinen
 * vastaanottaja ja alueet piirrettyinä, jotta asettelun voi tarkistaa
 * tulostamalla ja taittamalla kirjeen ikkunakuoreen.
 */
export async function loadMeetingLetterPreview(run: Runner, meetingId: string, calibration: boolean): Promise<Omit<LetterSource, "organizationId" | "companyId" | "subjectTable" | "subjectId" | "jobName">> {
  const plan = await run((tx) => planMeetingLetters(tx, meetingId));
  if (!plan) throw new LetterError("Kokousta ei löytynyt.");
  if (!plan.sender.lines) throw new LetterError(MISSING_SENDER_ADDRESS);
  const appendix = !calibration && plan.noticeDocument ? new Uint8Array(await readStoredFile(plan.noticeDocument.storage_path)) : null;
  return {
    sender: plan.sender.lines,
    date: isoDateHelsinki(),
    content: meetingContent(plan),
    appendix,
    recipients: calibration || plan.ready.length === 0 ? [SAMPLE_RECIPIENT] : plan.ready,
  };
}
