/**
 * Yhtiöön sovellettava laki (0107). AOYL 28:1: keskinäiseen
 * kiinteistöosakeyhtiöön sovelletaan asunto-osakeyhtiölakia, jollei
 * yhtiöjärjestyksessä määrätä toisin tai perusilmoitus ole tehty ennen
 * 1.1.1992. Silloin sovelletaan osakeyhtiölakia (624/2006).
 */

export const GOVERNING_ACTS = ["aoyl", "oyl"] as const;
export type GoverningAct = (typeof GOVERNING_ACTS)[number];

export const GOVERNING_ACT_LABEL: Record<GoverningAct, string> = {
  aoyl: "Asunto-osakeyhtiölaki (1599/2009)",
  oyl: "Osakeyhtiölaki (624/2006)",
};

export function resolveGoverningAct(companyForm: string, governingAct: string | null | undefined): GoverningAct {
  if (governingAct === "aoyl" || governingAct === "oyl") return governingAct;
  return companyForm === "other" ? "oyl" : "aoyl";
}

/** Pykäläviittaus sovellettavan lain mukaan, esim. cite("oyl", "6:23", "5:23") → "OYL 5:23 §". */
export function cite(act: GoverningAct, aoyl: string, oyl: string): string {
  return act === "oyl" ? `OYL ${oyl} §` : `AOYL ${aoyl} §`;
}
