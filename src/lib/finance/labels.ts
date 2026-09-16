export const CHARGE_TYPE: Record<string, string> = {
  maintenance: "Hoitovastike",
  land: "Maavastike",
  heating: "Lämmitysvastike",
  capital: "Pääomavastike",
  financing: "Rahoitusvastike",
  water: "Vesimaksu (kylmä vesi)",
  hot_water: "Lämmin vesi",
  water_advance: "Vesiennakko",
  sauna: "Saunamaksu",
  parking: "Autopaikkamaksu",
  other: "Muu maksu",
};

export const CHARGE_TYPE_TO_HTJ: Record<string, string | null> = {
  maintenance: "hoitovastike",
  land: "maavastike",
  heating: "lammitysvastike",
  capital: "paaomavastike",
  financing: "paaomavastike",
  water: null,
  hot_water: null,
  water_advance: null,
  sauna: null,
  parking: null,
  other: null,
};

/** Lainan laji isännöitsijäntodistukseen. Luottolimiitti näytetään omana taulukkonaan. */
export const LOAN_TYPE: Record<string, string> = {
  capital_charge: "Pääomavastikelaina",
  financing_charge: "Rahoitusvastikelaina",
  renovation: "Peruskorjauslaina",
  construction: "Rakennuslaina",
  credit_limit: "Luottolimiitti",
  other: "Muu laina",
};

export const BASIS: Record<string, { label: string; unit: string }> = {
  area_m2: { label: "Pinta-ala", unit: "m²" },
  share: { label: "Osakkeet", unit: "osake" },
  unit: { label: "Kappale", unit: "kpl" },
  person: { label: "Henkilö", unit: "hlö" },
  meter: { label: "Mittari", unit: "yks." },
  fixed: { label: "Kiinteä", unit: "kk" },
};

export const UNIT_KIND: Record<string, string> = {
  apartment: "Asuinhuoneisto",
  commercial: "Liiketila",
  parking: "Autopaikka",
  garage: "Autotalli",
  storage: "Varasto",
  other: "Muu",
};

/** Laskutusajon laji. */
export const RUN_KIND: Record<string, string> = {
  charges: "Vastikkeet",
  water_settlement: "Vesimaksun tasaus",
};

/** Vastikeperusteeksi kelpaavat lajit (vesiennakko on osakeryhmäkohtainen, er_water_advances). */
export const BASIS_CHARGE_TYPES = Object.keys(CHARGE_TYPE).filter((k) => k !== "water_advance");

export const RUN_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "alert" }> = {
  draft: { label: "Luonnos", tone: "warn" },
  approved: { label: "Hyväksytty", tone: "info" },
  exported: { label: "Viety kirjanpitoon", tone: "ok" },
  cancelled: { label: "Peruttu", tone: "neutral" },
};

/** Yksikköhinta näyttöön: vähintään kaksi desimaalia, turhat nollat pois ("3.0000" → "3,00", "0.0123" → "0,0123"). */
export function formatPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  const [int, frac = ""] = String(value).split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${int},${trimmed}`;
}

/** Euromäärä lomakkeen kenttään suomalaisella desimaalipilkulla. */
export function decimalInput(value: string | null | undefined): string {
  return value ? value.replace(".", ",") : "";
}

/** Desimaaliluku näyttöön ilman turhia nollia: "3.1500" → "3,15". */
export function trimDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  const s = String(value);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed.replace(".", ",");
}
