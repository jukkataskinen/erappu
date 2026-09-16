import { ITEMS, type Responsibility, type ResponsibilityItem } from "./content";

/**
 * Yhtiökohtaisten poikkeusten yhdistäminen vakiotulkintoihin. Puhdas funktio,
 * jotta sama tulos syntyy henkilökunnan ja portaalin sivulla ja testissä.
 */

export const EXCEPTION_BASES = ["articles", "meeting", "other"] as const;

export type ExceptionBasis = (typeof EXCEPTION_BASES)[number];

export const EXCEPTION_BASIS_LABEL: Record<ExceptionBasis, string> = {
  articles: "Yhtiöjärjestys",
  meeting: "Yhtiökokouksen päätös",
  other: "Muu peruste",
};

export interface ResponsibilityException {
  item_key: string;
  responsibility: Responsibility;
  basis: ExceptionBasis;
  note: string;
  decided_on: string | null;
}

/** Selaimelle välitettävä kohde: vakiotulkinta ja mahdollinen poikkeus. */
export interface ChartItem extends ResponsibilityItem {
  /** Voimassa oleva vastuu: poikkeus, jos sellainen on, muuten vakiotulkinta. */
  effective: Responsibility;
  exception: ResponsibilityException | null;
}

export function mergeExceptions(exceptions: ResponsibilityException[], items: ResponsibilityItem[] = ITEMS): ChartItem[] {
  const byKey = new Map(exceptions.map((e) => [e.item_key, e]));
  return items.map((item) => {
    const exception = byKey.get(item.key) ?? null;
    return { ...item, effective: exception?.responsibility ?? item.responsibility, exception };
  });
}

/**
 * Poikkeukset, joiden kohdetta ei enää ole vakiosisällössä (kohde poistettu
 * tai avain muutettu). Näytetään henkilökunnalle, jotta ne voi poistaa.
 */
export function orphanExceptions(exceptions: ResponsibilityException[], items: ResponsibilityItem[] = ITEMS): ResponsibilityException[] {
  const keys = new Set(items.map((i) => i.key));
  return exceptions.filter((e) => !keys.has(e.item_key));
}
