import type { Sql } from "@/lib/db";

/**
 * Hallituksen pöytäkirjan allekirjoittajat yhtiöjärjestyksen mukaan (0113).
 *
 * Tyhjä sääntö = laki (AOYL 7:6 §): puheenjohtaja ja vähintään yksi
 * hallituksen siihen valitsema jäsen tai läsnä ollut isännöitsijä. Tämä ja
 * "puheenjohtaja ja valittu jäsen" toteutetaan kokouksen puheenjohtajalla ja
 * pöytäkirjantarkastajilla. "Kaikki läsnä olleet" ottaa allekirjoittajiksi
 * jokaisen läsnä olleeksi merkityn osallistujan, ja sähköposti tulee
 * rekisteristä. Yhtiökokouksen pöytäkirjaa sääntö ei koske.
 */

export const BOARD_MINUTES_SIGNERS = ["chair_and_member", "all_present"] as const;
export type BoardMinutesSigners = (typeof BOARD_MINUTES_SIGNERS)[number];

export const BOARD_MINUTES_SIGNERS_LABEL: Record<BoardMinutesSigners | "law", string> = {
  law: "Lain mukaan: puheenjohtaja ja hallituksen valitsema jäsen tai läsnä ollut isännöitsijä",
  chair_and_member: "Puheenjohtaja ja hallituksen siihen valitsema jäsen",
  all_present: "Kaikki kokouksessa läsnä olleet",
};

export function boardMinutesSignersLabel(rule: string | null): string {
  return BOARD_MINUTES_SIGNERS_LABEL[(BOARD_MINUTES_SIGNERS as readonly string[]).includes(rule ?? "") ? (rule as BoardMinutesSigners) : "law"];
}

export interface SignerInput {
  name: string;
  email: string;
  role: string;
}

export interface MinutesSignerPlan {
  /** Hallituksen kokouksessa yhtiön sääntö, yhtiökokouksessa null. */
  rule: BoardMinutesSigners | "law" | null;
  ruleLabel: string | null;
  signers: SignerInput[];
  /** Estää lähetyksen: puuttuvat tiedot selkokielellä. */
  problems: string[];
  /** Ennen kokousta: läsnäoloja ei ole merkitty, joten allekirjoittajiksi oletetaan kaikki kutsutut. */
  preview: boolean;
  /** Kokoukselle ei ole kirjattu puheenjohtajaa, joten käytetään hallituksen puheenjohtajaa rekisteristä. */
  chairFromRegistry: boolean;
}

const nameKey = (name: string) => name.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");

interface MeetingForSigners {
  kind: string;
  chair_name: string | null;
  chair_email: string | null;
  minutes_checkers: { name: string; email: string }[];
  board_minutes_signers: string | null;
}

interface PresentAttendee {
  display_name: string;
  email: string | null;
}

/** Puhdas funktio: allekirjoittajat kokouksen tiedoista ja läsnä olleista. */
export function planMinutesSigners(
  meeting: MeetingForSigners,
  present: PresentAttendee[],
  opts: { registryChair?: { name: string; email: string | null } | null; preview?: boolean } = {},
): MinutesSignerPlan {
  const board = meeting.kind === "board";
  const preview = !!opts.preview;
  const rule = board ? ((BOARD_MINUTES_SIGNERS as readonly string[]).includes(meeting.board_minutes_signers ?? "") ? (meeting.board_minutes_signers as BoardMinutesSigners) : "law") : null;
  const ownChair = meeting.chair_name?.trim() && meeting.chair_email?.trim() ? { name: meeting.chair_name.trim(), email: meeting.chair_email.trim(), role: "Puheenjohtaja" } : null;
  // Hallituksen kokouksen puheenjohtaja on yleensä hallituksen puheenjohtaja: tyhjä kenttä täydentyy rekisteristä.
  const fallback = board && !meeting.chair_name?.trim() && opts.registryChair?.email?.trim() ? { name: opts.registryChair.name, email: opts.registryChair.email.trim(), role: "Puheenjohtaja" } : null;
  const chair = ownChair ?? fallback;
  const problems: string[] = [];
  const signers: SignerInput[] = [];
  if (!chair) problems.push("Anna puheenjohtajan nimi ja sähköposti.");
  else signers.push(chair);

  if (rule === "all_present") {
    if (present.length === 0) {
      problems.push(preview ? "Lisää osallistujat (Esitäytä hallituksesta): yhtiöjärjestyksen mukaan pöytäkirjan allekirjoittavat kaikki läsnä olleet." : "Merkitse osallistujista läsnä olleet: yhtiöjärjestyksen mukaan pöytäkirjan allekirjoittavat kaikki läsnä olleet.");
    }
    const missing: string[] = [];
    for (const a of present) {
      const email = a.email?.trim();
      const isChair = chair && ((email && email.toLowerCase() === chair.email.toLowerCase()) || nameKey(a.display_name) === nameKey(chair.name));
      if (isChair) continue;
      if (!email) {
        missing.push(a.display_name);
        continue;
      }
      if (signers.some((s) => s.email.toLowerCase() === email.toLowerCase())) continue;
      signers.push({ name: a.display_name, email, role: "Läsnä ollut" });
    }
    if (missing.length) problems.push(`Sähköposti puuttuu: ${missing.join(", ")}. Lisää se henkilön tietoihin rekisterissä.`);
    if (!problems.length && signers.length < 2 && present.length > 1) problems.push("Allekirjoittajia on vain yksi.");
  } else {
    for (const c of meeting.minutes_checkers ?? []) {
      if (c?.name && c?.email && !signers.some((s) => s.email.toLowerCase() === c.email.toLowerCase())) {
        signers.push({ name: c.name, email: c.email, role: board ? "Hallituksen valitsema jäsen" : "Pöytäkirjantarkastaja" });
      }
    }
    if (signers.length < 2) {
      problems.push(board ? "Anna hallituksen valitseman jäsenen nimi ja sähköposti (pöytäkirjantarkastaja)." : "Anna vähintään yhden pöytäkirjantarkastajan nimi ja sähköposti.");
    }
  }
  return { rule, ruleLabel: rule ? boardMinutesSignersLabel(rule === "law" ? null : rule) : null, signers, problems, preview: preview && rule === "all_present", chairFromRegistry: !ownChair && !!fallback };
}

/** Kokouksen allekirjoittajat tietokannasta (käyttäjän RLS-transaktiossa). */
export async function loadMinutesSignerPlan(tx: Sql, meetingId: string): Promise<MinutesSignerPlan | null> {
  const [meeting] = await tx.query<MeetingForSigners & { status: string; company_id: string }>(
    `select m.kind, m.status, m.company_id, m.chair_name, m.chair_email, m.minutes_checkers, c.board_minutes_signers
       from er_meetings m join er_housing_companies c on c.id = m.company_id where m.id = $1`,
    [meetingId],
  );
  if (!meeting) return null;
  const attendees = await tx.query<PresentAttendee & { present: boolean }>(
    `select a.display_name, p.email, a.present from er_meeting_attendees a left join er_parties p on p.id = a.party_id
      where a.meeting_id = $1 order by a.display_name`,
    [meetingId],
  );
  const [registryChair] = await tx.query<{ name: string; email: string | null }>(
    `select p.display_name as name, p.email from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role = chair and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
      order by b.starts_on desc limit 1`,
    [meeting.company_id],
  );
  const present = attendees.filter((a) => a.present);
  // Ennen kokousta ketään ei ole merkitty läsnä olevaksi: näytetään kaikki kutsutut.
  const preview = present.length === 0 && (meeting.status === "draft" || meeting.status === "notice_sent");
  return planMinutesSigners(meeting, preview ? attendees : present, { registryChair: registryChair ?? null, preview });
}
