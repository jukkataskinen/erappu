import { fail } from "@/lib/forms";
import { RequestError } from "./mutations";
import { PhotoError } from "./photos";

/**
 * Palvelintoimintojen virheenkäsittely: tunnetut virheet ohjataan takaisin
 * lomakkeelle yleisellä tekstillä. Kannan virheen yksityiskohtia (taulut,
 * sarakkeet) ei näytetä käyttäjälle.
 */
export async function guarded<T>(back: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RequestError || err instanceof PhotoError) fail(back, err.message);
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "42501") fail(back, "Roolillasi ei voi tehdä tätä muutosta.");
    if (code === "23503") fail(back, "Valintaa ei löytynyt. Tarkista yhtiö, huoneisto, vastuuhenkilö ja palveluntuottaja.");
    if (code === "22023" || code === "P0002") fail(back, "Toimintoa ei voi tehdä pyynnön nykyisessä tilassa.");
    throw err;
  }
}
