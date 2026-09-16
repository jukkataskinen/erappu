import { redirect } from "next/navigation";
import type { z } from "zod";

/**
 * Lomakkeiden apurit palvelintoiminnoille.
 *
 * Virheet palautetaan uudelleenohjauksella `?virhe=`-parametriin. Parametriin
 * kirjoitetaan vain yleinen virheteksti, ei koskaan lomakkeen sisältöä
 * (henkilötietoa ei URL-osoitteisiin).
 */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v.trim();
  }
  return out;
}

export function parseForm<S extends z.ZodTypeAny>(schema: S, formData: FormData, backTo: string): z.infer<S> {
  const result = schema.safeParse(formObject(formData));
  if (!result.success) {
    const first = result.error.issues[0];
    fail(backTo, first?.message && !first.message.startsWith("Invalid") ? first.message : "Tarkista lomakkeen tiedot.");
  }
  return result.data;
}

export function fail(backTo: string, message: string): never {
  const sep = backTo.includes("?") ? "&" : "?";
  redirect(`${backTo}${sep}virhe=${encodeURIComponent(message)}`);
}

/**
 * Tyhjä merkkijono → null. Käytetään zodin preprocessissa.
 *
 * Myös puuttuva kenttä (undefined) on null: sama skeema palvelee useaa
 * lomaketta, joissa kaikkia kenttiä ei ole. Ilman tätä hallituksen jäsenen
 * lisäys kaatui, koska lomakkeella ei ole puhelin- ja osoitekenttiä.
 */
export const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export function isExclusionViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23P01";
}
