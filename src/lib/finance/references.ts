import { isValidReferenceNumber, referenceNumber } from "@/lib/validation/finnish";

/**
 * Taloyhtiön vastikeviite: yhtiön numero + osakeryhmän järjestysnumero
 * kolmella numerolla + tarkiste. Viite on osakeryhmän, ei omistajan, joten
 * se ei muutu omistajanvaihdoksessa ja maksu kohdistuu huoneistoon.
 */
export function companyReference(companyNumber: number, seqNo: number): string {
  if (!Number.isInteger(companyNumber) || companyNumber < 1) throw new Error("Yhtiön numero puuttuu");
  if (!Number.isInteger(seqNo) || seqNo < 1 || seqNo > 999) throw new Error("Järjestysnumero on 1–999");
  return referenceNumber(`${companyNumber}${String(seqNo).padStart(3, "0")}`);
}

/** Kotimainen tai RF-viite vertailumuotoon (vain numerot, kotimainen). */
export function normalizeReference(value: string): string | null {
  const v = value.replace(/\s/g, "").toUpperCase();
  if (!v) return null;
  if (/^RF\d{2}\d+$/.test(v)) {
    const domestic = v.slice(4);
    return isValidReferenceNumber(domestic) ? domestic.replace(/^0+/, "") : null;
  }
  if (!/^\d+$/.test(v)) return null;
  const stripped = v.replace(/^0+/, "");
  return isValidReferenceNumber(stripped) ? stripped : null;
}

/** Huoneiston tunnus vertailumuotoon: "a 1" = "A1" = "A 1". */
export function normalizeUnitLabel(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/**
 * Luonnollinen järjestys huoneistotunnuksille (A 2 ennen A 10). Käytetään
 * järjestysnumeroiden ensimmäisessä jaossa.
 */
export function compareUnitLabels(a: string, b: string): number {
  return a.localeCompare(b, "fi", { numeric: true, sensitivity: "base" });
}

/**
 * Jakaa puuttuvat järjestysnumerot. Olemassa olevia ei muuteta, ja uudet
 * osakeryhmät saavat numerot suurimman käytetyn jälkeen tunnusjärjestyksessä.
 * Aukkoja ei täytetä: poistetun osakeryhmän viitteellä voi vielä tulla
 * suorituksia, eikä niitä saa kohdistaa toiseen huoneistoon.
 */
export function assignSequenceNumbers(
  groups: { id: string; unit_label: string }[],
  existing: Map<string, number>,
): { id: string; seqNo: number }[] {
  const missing = groups.filter((g) => !existing.has(g.id)).sort((a, b) => compareUnitLabels(a.unit_label, b.unit_label));
  let next = Math.max(0, ...existing.values()) + 1;
  return missing.map((g) => {
    if (next > 999) throw new Error("Yhtiössä voi olla enintään 999 viitenumeroa");
    return { id: g.id, seqNo: next++ };
  });
}
