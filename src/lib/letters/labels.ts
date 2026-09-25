import type { LetterJobRow } from "./jobs";

type Tone = "neutral" | "info" | "ok" | "warn" | "alert";

export const LETTER_JOB_STATUS: Record<LetterJobRow["status"], { label: string; tone: Tone }> = {
  uploading: { label: "Ladataan", tone: "warn" },
  NE: { label: "Odottaa vahvistusta", tone: "warn" },
  CO: { label: "Vahvistettu, lähtee seuraavana arkipäivänä", tone: "info" },
  PR: { label: "Postitan käsittelyssä", tone: "info" },
  SE: { label: "Postitettu", tone: "ok" },
  CA: { label: "Peruttu", tone: "neutral" },
  failed: { label: "Lataus epäonnistui", tone: "alert" },
};

export const POST_CLASS_LABEL: Record<1 | 2, string> = { 1: "1. luokka", 2: "2. luokka" };

/** Paluuosoitteet, joihin kirjetoiminnot saavat ohjata (ei avointa uudelleenohjausta). */
const BACK_PATHS = [/^\/taloyhtiot\/[0-9a-f-]{36}\/kokoukset\/[0-9a-f-]{36}$/i, /^\/tiedotteet\/[0-9a-f-]{36}$/i];

export function safeLetterBack(value: unknown): string | null {
  return typeof value === "string" && BACK_PATHS.some((re) => re.test(value)) ? value : null;
}

/** Ilmoitus kirjetoiminnon jälkeen (`?kirjeet=`). */
export const LETTER_FLASH: Record<string, string> = {
  ladattu: "Kirjeet on ladattu Postitaan vahvistamattomina. Tarkista vedos ja vahvista postitus.",
  vahvistettu: "Postitus on vahvistettu. Kirjeet lähtevät seuraavana arkipäivänä.",
  peruttu: "Kirjeet on peruttu. Ne voi ladata uudelleen.",
  paivitetty: "Kirjetyön tila on päivitetty.",
};
