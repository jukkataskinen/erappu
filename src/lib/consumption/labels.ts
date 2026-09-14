export const UTILITIES = ["electricity", "water", "heat"] as const;
export type Utility = (typeof UTILITIES)[number];
export type ConsumptionUnit = "kWh" | "MWh" | "m3";

export const UTILITY_LABEL: Record<Utility, string> = { electricity: "Sähkö", water: "Vesi", heat: "Lämpö" };

/** Vertailuyksikkö: sähkö ja lämpö kWh, vesi m³. */
export const CANONICAL_UNIT: Record<Utility, "kWh" | "m3"> = { electricity: "kWh", water: "m3", heat: "kWh" };

export const UNIT_LABEL: Record<ConsumptionUnit, string> = { kWh: "kWh", MWh: "MWh", m3: "m³" };
