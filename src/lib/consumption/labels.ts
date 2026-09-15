export const UTILITIES = ["electricity", "water", "heat", "oil"] as const;
export type Utility = (typeof UTILITIES)[number];
export type ConsumptionUnit = "kWh" | "MWh" | "m3" | "l";

/** `heat` on kaukolämpö: yhtiöissä ei ole muuta mitattua lämpöä. */
export const UTILITY_LABEL: Record<Utility, string> = { electricity: "Sähkö", water: "Vesi", heat: "Kaukolämpö", oil: "Lämmitysöljy" };

/** Vertailuyksikkö: sähkö ja kaukolämpö kWh, vesi m³, öljy litroina. */
export const CANONICAL_UNIT: Record<Utility, "kWh" | "m3" | "l"> = { electricity: "kWh", water: "m3", heat: "kWh", oil: "l" };

/** Lukeman syötössä sallitut yksiköt ja oletus. */
export const ALLOWED_UNITS: Record<Utility, ConsumptionUnit[]> = { electricity: ["kWh", "MWh"], water: ["m3"], heat: ["MWh", "kWh"], oil: ["l"] };

export const UNIT_LABEL: Record<ConsumptionUnit, string> = { kWh: "kWh", MWh: "MWh", m3: "m³", l: "l" };

export function unitAllowed(utility: Utility, unit: ConsumptionUnit): boolean {
  return ALLOWED_UNITS[utility].includes(unit);
}
