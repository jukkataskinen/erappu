import { formatDateTime } from "@/lib/format";
import { MEETING_KIND, type MeetingKind } from "./labels";

/**
 * Kokouskutsun vastaanottajat ja sähköpostiviesti.
 *
 * Sähköinen kutsu vain osakkaalle, joka on antanut suostumuksen ja jolla on
 * sähköpostiosoite (AOYL 6:21 §: kutsu toimitetaan yhtiöjärjestyksen
 * määräämällä tavalla; sähköinen toimitus vaatii osakkaan suostumuksen).
 * Muille tulostetaan paperikutsu.
 */

export interface NoticeParty {
  party_id: string;
  display_name: string;
  email: string | null;
  electronic_notice_consent: boolean;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  unit_labels: string;
}

export function splitNoticeRecipients<T extends NoticeParty>(parties: T[], requireConsent = true): { electronic: T[]; paper: T[] } {
  const seen = new Set<string>();
  const electronic: T[] = [];
  const paper: T[] = [];
  for (const p of parties) {
    if (seen.has(p.party_id)) continue;
    seen.add(p.party_id);
    const email = p.email?.trim();
    const validEmail = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (validEmail && (!requireConsent || p.electronic_notice_consent)) electronic.push(p);
    else paper.push(p);
  }
  return { electronic, paper };
}

const KIND_ILLATIVE: Record<MeetingKind, string> = {
  annual_general: "varsinaiseen yhtiökokoukseen",
  extraordinary_general: "ylimääräiseen yhtiökokoukseen",
  board: "hallituksen kokoukseen",
};

export interface NoticeMessageInput {
  companyName: string;
  kind: MeetingKind;
  startsAt: string;
  location: string | null;
  remoteParticipation: boolean;
  remoteUrl: string | null;
  items: { position: number; title: string }[];
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
}

/**
 * Viestin runko. Ei henkilötunnuksia eikä osakkaan muita tietoja: sama teksti
 * kaikille vastaanottajille. Etäyhteyden osoite on mukana, koska kutsu on
 * sen ainoa jakelukanava.
 */
export function buildNoticeMessage(m: NoticeMessageInput): { subject: string; body: string } {
  const kindLabel = MEETING_KIND[m.kind];
  const subject = `${m.companyName}: ${kindLabel.toLowerCase()} ${formatDateTime(m.startsAt)}`;
  const lines = [
    `Hei,`,
    ``,
    `${m.companyName} kutsuu sinut ${KIND_ILLATIVE[m.kind]}.`,
    ``,
    `Aika: ${formatDateTime(m.startsAt)}`,
    `Paikka: ${m.location || "ilmoitetaan erikseen"}`,
  ];
  if (m.remoteParticipation) {
    lines.push(`Etäosallistuminen: mahdollinen${m.remoteUrl ? `, ${m.remoteUrl}` : ""}`);
  }
  lines.push(``, `Asialista:`);
  for (const i of m.items) lines.push(`${i.position}. ${i.title}`);
  lines.push(
    ``,
    `Kokouskutsu ja asiakirjat ovat nähtävissä eRapun portaalissa. Jos et pääse paikalle, voit valtuuttaa asiamiehen päivätyllä valtakirjalla.`,
    ``,
    `Hallituksen puolesta`,
    [m.managerName, m.managerEmail, m.managerPhone].filter(Boolean).join(", ") || "Isännöitsijä",
  );
  return { subject, body: lines.join("\n") };
}
