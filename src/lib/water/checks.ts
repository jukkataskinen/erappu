/**
 * Mittarilukeman järkevyystarkistukset. Poikkeava lukema ei ole virhe
 * (mittari on voitu vaihtaa, asunto tyhjillään tai vuoto), mutta sen
 * tallentaminen vaatii kuittauksen, että lukema on tarkistettu.
 */

/** Kulutus alle tämän (m³) edellisestä lukemasta on epätavallisen pieni. */
export const SMALL_CONSUMPTION_M3 = 2;
/** Kulutus yli tämän (m³) edellisestä lukemasta on epätavallisen suuri. */
export const LARGE_CONSUMPTION_M3 = 500;

export type ReadingIssue = "lower" | "small" | "large";

const toThousandths = (v: string) => {
  const t = v.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  return Number(i) * 1000 + Number(f.padEnd(3, "0"));
};

export function readingIssues(previous: string | null | undefined, value: string): ReadingIssue[] {
  if (previous === null || previous === undefined || value.trim() === "") return [];
  const prev = toThousandths(previous);
  const next = toThousandths(value);
  if (prev === null || next === null) return [];
  const diff = next - prev;
  if (diff < 0) return ["lower"];
  if (diff < SMALL_CONSUMPTION_M3 * 1000) return ["small"];
  if (diff > LARGE_CONSUMPTION_M3 * 1000) return ["large"];
  return [];
}

export function issueText(issue: ReadingIssue, previous: string, value: string): string {
  const diff = ((toThousandths(value) ?? 0) - (toThousandths(previous) ?? 0)) / 1000;
  const m3 = diff.toLocaleString("fi-FI", { maximumFractionDigits: 3 });
  switch (issue) {
    case "lower":
      return `Lukema on pienempi kuin edellinen (${previous.replace(".", ",")}). Tarkista numerot.`;
    case "small":
      return `Kulutus on vain ${m3} m³ edellisestä lukemasta. Onko lukema oikein?`;
    case "large":
      return `Kulutus on ${m3} m³ edellisestä lukemasta, mikä on poikkeuksellisen paljon. Onko lukema oikein?`;
  }
}
