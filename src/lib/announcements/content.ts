import { isValidHetu } from "@/lib/validation/finnish";
import { formatDate } from "@/lib/format";

/**
 * Tiedotteen sisällön apurit: sähköpostin muodostus ja henkilötunnusvahti.
 * Tiedote lähtee sähköpostina kymmenille vastaanottajille, joten
 * henkilötunnus ei saa päätyä siihen vahingossakaan (CLAUDE.md 0.1).
 */

const HETU_CANDIDATE = /\b\d{6}[-+A-FU-Y]\d{3}[0-9A-Y]\b/gi;

export function containsHetu(text: string): boolean {
  for (const m of text.matchAll(HETU_CANDIDATE)) {
    if (isValidHetu(m[0].toUpperCase())) return true;
  }
  return false;
}

export function composeAnnouncementEmail(a: {
  companyName: string;
  title: string;
  body: string;
  validUntil: string | null;
  portalUrl: string | null;
}): { subject: string; body: string } {
  const lines = [
    a.body.trim(),
    "",
    a.validUntil ? `Tiedote on voimassa ${formatDate(a.validUntil)} asti.` : null,
    a.portalUrl ? `Tiedote portaalissa: ${a.portalUrl}` : null,
    "",
    "--",
    `${a.companyName}, isännöinti`,
    "Saat tämän viestin, koska olet yhtiön osakas, asukas tai hallituksen jäsen.",
  ].filter((l): l is string => l !== null);
  return { subject: `${a.companyName}: ${a.title}`.slice(0, 250), body: lines.join("\n") };
}
