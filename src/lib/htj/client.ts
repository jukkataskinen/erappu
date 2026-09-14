import type {
  HtjCallMeta,
  HtjChange,
  HtjCompany,
  HtjMode,
  HtjOwner,
  HtjRestriction,
  HtjScope,
  HtjShareGroup,
  HtjSubmissionKind,
  HtjSubmitResult,
} from "./types";

/**
 * HTJ-asiakkaan rajapinta. Toteutukset: `mock.ts` (kuvitteellinen data,
 * oletus) ja `mml.ts` (Maanmittauslaitoksen rajapinta mTLS:llä).
 *
 * Sovelluskoodi ei kutsu toteutuksia suoraan, vaan `withRequestLog`-kääreen
 * kautta (`log.ts`), jotta jokainen haku kirjautuu hakulokiin.
 */
export interface HtjClient {
  readonly mode: HtjMode;
  /** Yhtiön perustiedot Y-tunnuksella. null = yhtiö ei ole HTJ:ssä tai lupa puuttuu. */
  getCompany(businessId: string, meta: HtjCallMeta): Promise<HtjCompany | null>;
  listShareGroups(businessId: string, meta: HtjCallMeta): Promise<HtjShareGroup[]>;
  /** Omistajat. Suppea haku on oletus; laaja vain toimenpiteeseen, joka vaatii henkilötunnuksen. */
  listOwners(businessId: string, scope: HtjScope, meta: HtjCallMeta): Promise<HtjOwner[]>;
  listRestrictions(businessId: string, meta: HtjCallMeta): Promise<HtjRestriction[]>;
  /** Muutostiedot kaikista järjestelmäluvan kattamista yhtiöistä annetusta hetkestä alkaen. */
  listChanges(since: Date, meta: HtjCallMeta): Promise<HtjChange[]>;
  submit(businessId: string, kind: HtjSubmissionKind, payload: unknown, meta: HtjCallMeta): Promise<HtjSubmitResult>;
}

/**
 * Poistaa henkilötunnukset omistajista. Kutsutaan jokaisen toteutuksen
 * palautusarvolle, jotta laajankaan haun tunnus ei päädy sovelluskoodiin
 * vahingossa (lokit, erot, virheviestit).
 */
export function stripPersonalIds(owners: HtjOwner[]): HtjOwner[] {
  return owners.map((o) => {
    const { personalId, ...rest } = o;
    void personalId;
    return rest;
  });
}
