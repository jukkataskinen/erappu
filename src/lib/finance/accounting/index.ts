import { csvAdapter } from "./csv";
import type { KirjanpitoAdapteri } from "./types";

export type { BillingExportLine, BillingRunExport, ExportedFile, KirjanpitoAdapteri } from "./types";
export { csvAdapter } from "./csv";

/**
 * Käytössä oleva kirjanpitoadapteri. Procountorin aikana (31.12.2027 asti)
 * CSV. PPR-adapteri (./ppr.ts) otetaan käyttöön, kun rajapinta on olemassa;
 * silloin valinta tehdään organisaation asetuksesta.
 */
export function getAccountingAdapter(): KirjanpitoAdapteri {
  return csvAdapter;
}
