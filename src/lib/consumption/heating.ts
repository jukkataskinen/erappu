import type { Sql } from "@/lib/db";
import type { Utility } from "./labels";

/**
 * Yhtiön lämmitysmuoto kulutusseurantaa varten.
 *
 * Rakennusten lämmitysmuodoista päätellään, mitkä lämmityksen kulutuslajit
 * ovat mielekkäitä: kaukolämmössä kaukolämpölukemat, öljylämmityksessä öljyn
 * kulutus. Suorassa sähkössä ja maalämmössä lämmitys sisältyy sähkönkulutukseen,
 * joten erillistä lämpövälilehteä ei näytetä.
 */
export type HeatingType = "district_heat" | "oil" | "direct_electric" | "ground_source" | "air_water" | "wood" | "other";

export const HEATING_TYPE_LABEL: Record<HeatingType, string> = {
  district_heat: "Kaukolämpö",
  oil: "Öljylämmitys",
  direct_electric: "Suora sähkö",
  ground_source: "Maalämpö",
  air_water: "Ilma-vesilämpöpumppu",
  wood: "Puu tai pelletti",
  other: "Muu",
};

export const HEATING_TYPES = Object.keys(HEATING_TYPE_LABEL) as HeatingType[];

/** Sama jäsennys kuin migraatiossa 0081, käytetään lomakkeissa ja tuonnissa. */
export function classifyHeating(text: string | null | undefined): HeatingType | null {
  const v = (text ?? "").toLocaleLowerCase("fi");
  if (!v.trim()) return null;
  if (v.includes("kaukol")) return "district_heat";
  if (v.includes("öljy") || v.includes("oljy")) return "oil";
  if (v.includes("maalä") || v.includes("maala")) return "ground_source";
  if (v.includes("ilma-vesi") || v.includes("ilmavesi")) return "air_water";
  if (v.includes("puu") || v.includes("pelletti") || v.includes("hake")) return "wood";
  if (v.includes("sähkö") || v.includes("sahko")) return "direct_electric";
  return "other";
}

export interface HeatingProfile {
  types: HeatingType[];
  /** Lämmityksen kulutuslajit, joille näytetään oma välilehti. */
  heatingUtilities: Utility[];
  /** Selitys, kun lämmitys sisältyy sähköön tai muotoa ei tiedetä. */
  note: string | null;
}

export function heatingProfile(types: (HeatingType | null)[], utilitiesWithReadings: Utility[] = []): HeatingProfile {
  const known = [...new Set(types.filter((t): t is HeatingType => t !== null))];
  const utilities = new Set<Utility>();
  if (known.includes("district_heat")) utilities.add("heat");
  if (known.includes("oil")) utilities.add("oil");
  // Aiemmin tallennettuja lukemia ei piiloteta, vaikka lämmitysmuoto olisi muuttunut.
  for (const u of utilitiesWithReadings) if (u === "heat" || u === "oil") utilities.add(u);

  let note: string | null = null;
  if (known.length === 0) {
    note = "Lämmitysmuotoa ei ole kirjattu. Lisää se rakennuksen tietoihin (Kiinteistö-välilehti), niin oikea lämmityksen seuranta tulee näkyviin.";
    utilities.add("heat");
  } else if (utilities.size === 0) {
    if (known.every((t) => t === "direct_electric")) {
      // Suorassa sähkölämmityksessä kukin osakas maksaa lämmityksensä oman
      // huoneistonsa sähkösopimuksella, joten yhtiöllä ei ole seurattavaa.
      note = "Lämmitys: suora sähkö. Jokainen osakas maksaa oman lämmityksensä huoneiston sähkösopimuksella, joten yhtiön lämmönkulutusta ei seurata.";
    } else {
      const names = known.map((t) => HEATING_TYPE_LABEL[t].toLocaleLowerCase("fi")).join(" ja ");
      note = `Lämmitys: ${names}. Lämmitysenergia sisältyy sähkönkulutukseen, joten erillistä lämmön seurantaa ei ole.`;
    }
  }
  const order: Utility[] = ["heat", "oil"];
  return { types: known, heatingUtilities: order.filter((u) => utilities.has(u)), note };
}

export async function companyHeatingTypes(tx: Sql, companyId: string): Promise<(HeatingType | null)[]> {
  const rows = await tx.query<{ heating_type: HeatingType | null; heating: string | null }>(
    "select heating_type, heating from er_buildings where company_id = $1",
    [companyId],
  );
  return rows.map((r) => r.heating_type ?? classifyHeating(r.heating));
}
