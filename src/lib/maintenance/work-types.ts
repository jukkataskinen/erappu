/**
 * Kunnossapito- ja muutostöiden työlajit.
 *
 * TODO(MML-koodisto): HTJ:n ylläpitorajapinnalla on oma työlajikoodisto,
 * jota ei ole vielä saatavilla. Luettelo on laadittu HTJ:n asiointipalvelun
 * ja isännöitsijäntodistuksen korjaushistorian tyypillisten otsikoiden
 * mukaan. Kannassa työlaji on tekstinä (`work_type`), ja koodi yhdistetään
 * tähän luetteloon ilmoitusta muodostettaessa, joten koodiston tultua
 * riittää täydentää `htjCode`-kentät.
 */
export interface WorkType {
  label: string;
  /** TODO(MML-koodisto) */
  htjCode: string | null;
}

export const WORK_TYPES: readonly WorkType[] = [
  { label: "Vesikatto", htjCode: null },
  { label: "Julkisivu", htjCode: null },
  { label: "Ikkunat", htjCode: null },
  { label: "Parvekkeet", htjCode: null },
  { label: "Käyttövesi- ja viemäriputket", htjCode: null },
  { label: "Lämmitysjärjestelmä", htjCode: null },
  { label: "Ilmanvaihto", htjCode: null },
  { label: "Sähköjärjestelmä", htjCode: null },
  { label: "Hissit", htjCode: null },
  { label: "Salaojat", htjCode: null },
  { label: "Pihat ja alueet", htjCode: null },
  { label: "Märkätilat", htjCode: null },
  { label: "Keittiö", htjCode: null },
  { label: "Muu", htjCode: null },
] as const;

export const WORK_TYPE_LABELS: string[] = WORK_TYPES.map((w) => w.label);

export function isKnownWorkType(value: string | null | undefined): boolean {
  return !!value && WORK_TYPE_LABELS.includes(value);
}
