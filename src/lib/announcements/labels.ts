/** Tiedotteiden tilat, kohderyhmät ja kanavat käyttöliittymään. */

export const AUDIENCE_ROLES = ["owner", "resident", "board"] as const;
export type AudienceRole = (typeof AUDIENCE_ROLES)[number];

export const AUDIENCE_LABEL: Record<string, string> = {
  owner: "Osakkaat",
  resident: "Asukkaat",
  board: "Hallitus",
};

export const CHANNELS = ["portal", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<string, string> = {
  portal: "Portaali",
  email: "Sähköposti",
};

export const ANNOUNCEMENT_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "alert" }> = {
  draft: { label: "Luonnos", tone: "warn" },
  published: { label: "Julkaistu", tone: "ok" },
  archived: { label: "Arkistoitu", tone: "neutral" },
};

export const MESSAGE_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "alert" }> = {
  queued: { label: "Jonossa", tone: "warn" },
  sent: { label: "Lähetetty", tone: "ok" },
  delivered: { label: "Toimitettu", tone: "ok" },
  failed: { label: "Epäonnistui", tone: "alert" },
};

export function audienceText(roles: string[]): string {
  return roles.map((r) => AUDIENCE_LABEL[r] ?? r).join(", ");
}

/** Vastaanottajan osoitteesta näytetään vain verkkotunnus (lokit ja jononäkymä). */
export function maskEmail(email: string): string {
  const domain = email.split("@")[1];
  return domain ? `*@${domain}` : "*";
}
