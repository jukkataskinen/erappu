import type { ContractCategory } from "@/lib/contracts/labels";

/**
 * Sopimuspohjan malli. Pohjat ovat koodissa (kuten asialistapohjat M5:ssä),
 * täytetyt arvot kannassa (`er_contract_batches.shared_values`,
 * `er_contract_batch_items.values`). Näin pohjan teksti on versionhallinnassa
 * ja jokaisesta sopimuksesta tiedetään, millä pohjan versiolla se tehtiin.
 */

export type FieldType = "text" | "textarea" | "email" | "date" | "money" | "boolean" | "integer" | "provider";

/**
 * Mistä kentän oletusarvo esitäytetään rekisteristä.
 * `representative.*` = hallituksen puheenjohtaja, tai jos sitä ei ole, vastuuisännöitsijä.
 */
export type FieldSource =
  | "company.name"
  | "company.business_id"
  | "company.address"
  | "representative.name"
  | "representative.email"
  | "provider.name"
  | "provider.business_id"
  | "provider.email";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** `batch` = sama kaikille yhtiöille, `company` = yhtiökohtainen. */
  scope: "batch" | "company";
  required: boolean;
  /** Yhteisen kentän voi ylikirjoittaa yhtiölle (esim. poikkeava hinta). */
  overridable?: boolean;
  /** Kiinteä oletus tai päivästä laskettava oletus (esim. kauden päättyminen). */
  default?: string | boolean | ((today: string) => string);
  source?: FieldSource;
  hint?: string;
}

export interface TemplateSection {
  /** Otsikko ilman numeroa; numero lasketaan järjestyksestä, jotta numerointi pysyy juoksevana. */
  heading: string;
  /** Avain–arvo-parit (esim. sopijapuolet). Arvoissa voi olla paikkamerkkejä. */
  keyValues?: { label: string; value: string }[];
  paragraphs?: string[];
}

export interface SignatureRole {
  role: string;
  /** Nimi paikkamerkkeineen, esim. `{{client_representative}}`. */
  name: string;
}

export interface SignerDef {
  roleLabel: string;
  name: string;
  email: string;
}

export interface ContractTemplate {
  key: string;
  version: number;
  name: string;
  /** PDF:n pääotsikko. */
  title: string;
  category: ContractCategory;
  description: string;
  /** Juridinen hyväksyntä: false → PDF:ään luonnosmerkintä. */
  approved: boolean;
  noticeMonths: number | null;
  /** Kenttä, joka kertoo sopimuksen päättymispäivän (er_contracts.ends_on). */
  endsOnField: string | null;
  /** Dokumentin otsikko, esim. "Lumityösopimus {{provider_name}} {{valid_until}}". */
  documentTitle: string;
  /** Sopimusrekisterin kuvaus. */
  contractDescription: string;
  fields: FieldDef[];
  sections: TemplateSection[];
  signatureRoles: SignatureRole[];
  /** eSinetin allekirjoittajat. */
  signers: SignerDef[];
  /** Uuden erän otsikon ehdotus. */
  defaultBatchTitle: (today: string) => string;
  /** Esimerkkiarvot esikatselu-PDF:ää varten (kaikki paikkamerkit). */
  exampleValues: Record<string, string | boolean>;
}

export type FieldValue = string | boolean | null;
export type TemplateValues = Record<string, FieldValue>;

/**
 * Paikkamerkit, joita ei täytetä lomakkeella vaan rekisteristä muodostuksen
 * hetkellä. Ne ovat tekstiä eivätkä tarvitse kenttämäärittelyä.
 */
export const CONTEXT_KEYS = ["company_name", "company_business_id", "provider_name", "provider_business_id", "batch_title"] as const;
