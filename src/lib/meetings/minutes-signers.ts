import type { Sql } from "@/lib/db";

/**
 * Hallituksen pöytäkirjan allekirjoittajat yhtiöjärjestyksen mukaan (0113).
 *
 * Tyhjä sääntö = laki (AOYL 7:6 §): puheenjohtaja ja vähintään yksi
 * hallituksen siihen valitsema jäsen tai läsnä ollut isännöitsijä. Tämä ja
 * "puheenjohtaja ja valittu jäsen" toteutetaan kokouksen puheenjohtajalla ja
 * pöytäkirjantarkastajilla. "Kaikki läsnä olleet" ottaa allekirjoittajiksi
 * jokaisen läsnä olleeksi merkityn osallistujan; sähköposti tulee
 * rekisteristä tai läsnäolijalle kirjatusta osoitteesta (0119), jotta myös
 * käsin lisätty läsnäolija – isännöitsijä – voi allekirjoittaa.
 * Yhtiökokouksen pöytäkirjaa sääntö ei koske.
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

const nameWords = (name: string) =>
  name
    .toLowerCase()
    .replace(/[,.;:()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Sama henkilö eri kirjoitusasuilla: "Jouttijärvi Olavi" = "Olavi Jouttijärvi",
 * ja käsin kirjoitettu "Jukka Taskinen, isännöitsijä" = "Jukka Taskinen".
 * Vaatii vähintään kaksi yhteistä sanaa, jotta pelkkä etunimi ei riitä.
 */
export function sameName(a: string, b: string): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (x.length < 2 || y.length < 2) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

interface MeetingForSigners {
  kind: string;
  chair_name: string | null;
  chair_email: string | null;
  /** Kokouksen sihteeri, yleensä isännöitsijä. Allekirjoittaa sihteerinä, ei kahdesti. */
  secretary_name?: string | null;
  minutes_checkers: { name: string; email: string }[];
  board_minutes_signers: string | null;
}

interface PresentAttendee {
  display_name: string;
  email: string | null;
  /** Rekisterin henkilö vai käsin lisätty läsnäolija (esim. isännöitsijä). */
  party_id?: string | null;
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
      const isChair = chair && ((email && email.toLowerCase() === chair.email.toLowerCase()) || sameName(a.display_name, chair.name));
      if (isChair) continue;
      if (!email) {
        missing.push(a.display_name);
        continue;
      }
      if (signers.some((s) => s.email.toLowerCase() === email.toLowerCase())) continue;
      // Käsin lisätty läsnäolija ei ole hallituksen jäsen (yleensä isännöitsijä).
      signers.push({ name: a.display_name, email, role: a.party_id === null ? "Läsnä ollut" : "Hallituksen jäsen" });
    }
    if (missing.length) problems.push(`Sähköposti puuttuu: ${missing.join(", ")}. Lisää se läsnäolijan riville tai henkilön tietoihin rekisterissä.`);
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
  // Sihteeri (yleensä isännöitsijä) allekirjoittaa sihteerinä eikä erillisenä
  // läsnäolijana: pöytäkirjaan ei tule kahta riviä samalle henkilölle.
  const secretary = meeting.secretary_name?.trim();
  if (secretary) {
    for (const s of signers) {
      if (s.role !== "Puheenjohtaja" && sameName(s.name, secretary)) s.role = "Sihteeri";
    }
  }
  return { rule, ruleLabel: rule ? boardMinutesSignersLabel(rule === "law" ? null : rule) : null, signers, problems, preview: preview && rule === "all_present", chairFromRegistry: !ownChair && !!fallback };
}

/** Kokouksen allekirjoittajat tietokannasta (käyttäjän RLS-transaktiossa). */
export async function loadMinutesSignerPlan(tx: Sql, meetingId: string): Promise<MinutesSignerPlan | null> {
  const [meeting] = await tx.query<MeetingForSigners & { status: string; company_id: string }>(
    `select m.kind, m.status, m.company_id, m.chair_name, m.chair_email, m.secretary_name, m.minutes_checkers, c.board_minutes_signers
       from er_meetings m join er_housing_companies c on c.id = m.company_id where m.id = $1`,
    [meetingId],
  );
  if (!meeting) return null;
  const attendees = await tx.query<PresentAttendee & { present: boolean }>(
    `select a.display_name, coalesce(a.email, p.email) as email, a.party_id, a.present
       from er_meeting_attendees a left join er_parties p on p.id = a.party_id
      where a.meeting_id = $1 order by a.display_name`,
    [meetingId],
  );
  const [registryChair] = await tx.query<{ name: string; email: string | null }>(
    `select p.display_name as name, p.email from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role = 'chair' and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
      order by b.starts_on desc limit 1`,
    [meeting.company_id],
  );
  const present = attendees.filter((a) => a.present);
  // Ennen kokousta ketään ei ole merkitty läsnä olevaksi: näytetään kaikki kutsutut.
  const preview = present.length === 0 && (meeting.status === "draft" || meeting.status === "notice_sent");
  return planMinutesSigners(meeting, preview ? attendees : present, { registryChair: registryChair ?? null, preview });
}

type SignerFields = { chair_name: string | null; chair_email: string | null; minutes_checkers: { name: string | null; email: string | null }[] | null };

const signerSummary = (m: SignerFields) => ({
  chair: m.chair_name?.trim() ? `${m.chair_name.trim()}${m.chair_email?.trim() ? ` <${m.chair_email.trim()}>` : ""}` : null,
  checkers: (m.minutes_checkers ?? []).filter((c) => c?.name?.trim()).map((c) => `${c.name!.trim()}${c.email?.trim() ? ` <${c.email.trim()}>` : ""}`),
});

/**
 * Puheenjohtajan ja pöytäkirjantarkastajien muutos tapahtumalokiin
 * (Jukka 22.9.2026). Palauttaa null, jos mikään ei muuttunut.
 */
export function minutesSignerChange(before: SignerFields | null, after: SignerFields): { before: ReturnType<typeof signerSummary>; after: ReturnType<typeof signerSummary> } | null {
  const b = signerSummary(before ?? { chair_name: null, chair_email: null, minutes_checkers: [] });
  const a = signerSummary(after);
  if (b.chair === a.chair && b.checkers.join("|") === a.checkers.join("|")) return null;
  return { before: b, after: a };
}

export interface MinutesSignerChangeRow {
  at: string;
  by: string | null;
  before: { chair: string | null; checkers: string[] };
  after: { chair: string | null; checkers: string[] };
}

/** Kokouksen allekirjoittajamuutokset uusimmasta alkaen. Tapahtumaloki näkyy pääkäyttäjälle ja isännöitsijälle (RLS). */
export async function listMinutesSignerChanges(tx: Sql, meetingId: string): Promise<MinutesSignerChangeRow[]> {
  const rows = await tx.query<{ at: string; by: string | null; details: { before: MinutesSignerChangeRow["before"]; after: MinutesSignerChangeRow["after"] } }>(
    `select l.created_at as at, coalesce(u.full_name, u.email) as by, l.details
       from er_audit_log l left join er_users u on u.id = l.user_id
      where l.entity = 'meeting' and l.entity_id = $1 and l.action = 'change_minutes_signers'
      order by l.created_at desc limit 20`,
    [meetingId],
  );
  return rows.map((r) => ({ at: r.at, by: r.by, before: r.details.before, after: r.details.after }));
}
