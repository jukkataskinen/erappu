/**
 * HTJ2-ilmoitusvelvollisuuden päättely.
 *
 * Taloyhtiön on ilmoitettava vastikkeet, yhtiölainat ja lainaosuudet,
 * kunnossapito- ja muutostyöt sekä kunnossapitotarveselvitys HTJ:hin, jos
 * yhtiössä on yli viisi huoneistoa tai sillä on osakkaille jaettava
 * yhtiölaina. Muuten ilmoittaminen on vapaaehtoista (omistaja, pankki tai
 * välittäjä voi silti pyytää tietoja). Huoneistoiksi lasketaan asuin- ja
 * liikehuoneistot, ei autopaikkoja eikä varastoja.
 */

export type ObligationLevel = "mandatory" | "voluntary";

export interface ObligationInput {
  apartmentCount: number;
  commercialCount: number;
  loans: { allocated: boolean; balanceEur: number | null; paidOff?: boolean }[];
}

export interface Obligation {
  level: ObligationLevel;
  unitCount: number;
  hasAllocatedLoan: boolean;
  reasons: string[];
}

export const HTJ2_UNIT_THRESHOLD = 5;

export function htj2Obligation(input: ObligationInput): Obligation {
  const unitCount = input.apartmentCount + input.commercialCount;
  // Laina on jaettava, jos se on jaettu osakkaille eikä sitä ole maksettu
  // pois. Tuntematon saldo tulkitaan varmuuden vuoksi avoimeksi.
  const hasAllocatedLoan = input.loans.some((l) => l.allocated && !l.paidOff && (l.balanceEur === null || l.balanceEur > 0));
  const reasons: string[] = [];
  if (unitCount > HTJ2_UNIT_THRESHOLD) reasons.push(`Yhtiössä on ${unitCount} huoneistoa (yli ${HTJ2_UNIT_THRESHOLD}).`);
  if (hasAllocatedLoan) reasons.push("Yhtiöllä on osakkaille jaettava yhtiölaina.");
  if (reasons.length > 0) return { level: "mandatory", unitCount, hasAllocatedLoan, reasons };
  return {
    level: "voluntary",
    unitCount,
    hasAllocatedLoan,
    reasons: [`Yhtiössä on enintään ${HTJ2_UNIT_THRESHOLD} huoneistoa (${unitCount}) eikä jaettavaa yhtiölainaa. Ilmoittaminen on vapaaehtoista.`],
  };
}

export const OBLIGATION_LABEL: Record<ObligationLevel, string> = { mandatory: "Pakollinen", voluntary: "Vapaaehtoinen" };
