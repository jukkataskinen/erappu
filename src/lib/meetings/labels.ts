export type MeetingKind = "annual_general" | "extraordinary_general" | "board";
export type MeetingStatus = "draft" | "notice_sent" | "held" | "minutes_signed" | "cancelled";

export const MEETING_KINDS: MeetingKind[] = ["annual_general", "extraordinary_general", "board"];

export const MEETING_KIND: Record<MeetingKind, string> = {
  annual_general: "Varsinainen yhtiökokous",
  extraordinary_general: "Ylimääräinen yhtiökokous",
  board: "Hallituksen kokous",
};

export const MEETING_STATUS: Record<MeetingStatus, string> = {
  draft: "Luonnos",
  notice_sent: "Kutsu lähetetty",
  held: "Pidetty",
  minutes_signed: "Pöytäkirja allekirjoitettu",
  cancelled: "Peruttu",
};

export const MEETING_STATUS_TONE: Record<MeetingStatus, "neutral" | "info" | "ok" | "warn" | "alert"> = {
  draft: "neutral",
  notice_sent: "info",
  held: "warn",
  minutes_signed: "ok",
  cancelled: "neutral",
};

export const SIGNING_STATUS: Record<string, string> = {
  draft: "Luonnos",
  sent: "Odottaa allekirjoituksia",
  partially_signed: "Osittain allekirjoitettu",
  completed: "Allekirjoitettu",
  cancelled: "Peruttu",
  expired: "Vanhentunut",
  error: "Virhe",
};

export function isGeneralMeeting(kind: string): boolean {
  return kind === "annual_general" || kind === "extraordinary_general";
}

/**
 * Asialistan kohta, jossa läsnäolijat todetaan: ensisijaisesti
 * "läsnäolijat"/"ääniluettelo", muuten "laillisuus ja päätösvaltaisuus"
 * (hallituksen kokouksen pohjassa läsnäolijat todetaan siinä). Kokoussivu
 * näyttää läsnäolojen merkinnän tässä kohdassa, ja pöytäkirjaan läsnä olleet
 * kirjataan samaan pykälään.
 */
export function attendanceItemPosition(items: { position: number; title: string }[]): number | null {
  const primary = items.find((i) => /läsnäolij|ääniluettelo/i.test(i.title));
  const fallback = items.find((i) => /päätösvaltai/i.test(i.title));
  return (primary ?? fallback)?.position ?? null;
}
