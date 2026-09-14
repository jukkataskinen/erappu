import type { OrgRole } from "@/lib/auth/current-user";

/**
 * Kutsujen puhtaat säännöt (ei kantaa), jotta ne voi testata erikseen.
 */

/** Kutsu vanhenee kahdessa viikossa. Uusi linkki saadaan "Lähetä uudelleen". */
export const INVITE_TTL_DAYS = 14;

export const STAFF_ROLES: OrgRole[] = ["owner", "manager", "accountant", "assistant"];

export const STAFF_ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Pääkäyttäjä",
  manager: "Isännöitsijä",
  accountant: "Kirjanpitäjä",
  assistant: "Assistentti",
};

export type PortalInviteRole = "owner" | "resident" | "board";

export const PORTAL_INVITE_ROLE_LABEL: Record<PortalInviteRole, string> = {
  owner: "Osakas",
  resident: "Asukas",
  board: "Hallituksen jäsen",
};

/**
 * Roolit, joihin käyttäjä saa kutsua. Pääkäyttäjäksi vain pääkäyttäjä, koska
 * pääkäyttäjä hallitsee jäseniä; muuten isännöitsijä voisi korottaa itsensä
 * kutsumalla toisen tunnuksensa.
 */
export function assignableStaffRoles(inviterRole: OrgRole): OrgRole[] {
  if (inviterRole === "owner") return [...STAFF_ROLES];
  if (inviterRole === "manager") return ["manager", "accountant", "assistant"];
  return [];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sähköpostien vertailu kirjainkoosta riippumatta. */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeEmail(a) === normalizeEmail(b);
}

/** randomToken() tuottaa base64url-merkkijonon; muu syöte hylätään ennen kantaa. */
export function isInviteTokenShaped(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,100}$/.test(token);
}

export function inviteUrl(token: string, baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000"): string {
  return `${baseUrl.replace(/\/+$/, "")}/kutsu/${token}`;
}
