import { SNOW_PLOUGHING } from "./snow-ploughing";
import type { ContractTemplate } from "./types";

/** Pohjarekisteri. Uusi pohja lisätään tähän listaan omana tiedostonaan. */
export const TEMPLATES: readonly ContractTemplate[] = [SNOW_PLOUGHING];

export function getTemplate(key: string): ContractTemplate | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}

export type { ContractTemplate, FieldDef, FieldValue, TemplateValues } from "./types";
