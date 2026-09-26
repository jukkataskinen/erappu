/**
 * Kirjeen osoitetiedot. Puhdasta logiikkaa, ei kantaa eikä PDF:ää.
 */

export interface PostalParty {
  display_name: string;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  country?: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/**
 * Vastaanottajan osoiterivit (enintään neljä, Postitan osoitekenttä) tai
 * null, jos osoite on puutteellinen. Puutteelliselle osoitteelle ei tehdä
 * kirjettä: palautuva kirje maksaa ja kutsu jää silti toimittamatta.
 * Ulkomaan osoitteeseen maan nimi englanniksi isoin kirjaimin, kuten Posti
 * ohjeistaa.
 */
export function postalAddressLines(p: PostalParty): string[] | null {
  const name = clean(p.display_name);
  const street = clean(p.street_address);
  const postalCode = clean(p.postal_code);
  const city = clean(p.city);
  if (!name || !street || !postalCode || !city) return null;
  const lines = [name, street, `${postalCode} ${city}`];
  const country = clean(p.country).toUpperCase();
  if (country && country !== "FI") lines.push(countryName(country));
  return lines;
}

function countryName(code: string): string {
  try {
    return (new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code).toUpperCase();
  } catch {
    return code;
  }
}

export interface FittedLine {
  text: string;
  size: number;
}

/**
 * Rivi mahtumaan osoitekenttään: fonttia pienennetään puolen pisteen
 * askelin alarajaan asti ja vasta sitten rivi lyhennetään. Liian leveä rivi
 * näkyisi ikkunasta väärin tai jäisi kuoren alle.
 */
export function fitLine(text: string, maxWidth: number, sizes: { max: number; min: number }, measure: (text: string, size: number) => number): FittedLine {
  let size = sizes.max;
  while (size > sizes.min && measure(text, size) > maxWidth) size -= 0.5;
  let t = text;
  while (t.length > 1 && measure(t, size) > maxWidth) t = t.slice(0, -1);
  return { text: t.trimEnd(), size };
}
