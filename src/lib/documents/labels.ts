/** Dokumenttipankin luokat ja näkyvyydet käyttöliittymään. */

export const DOCUMENT_CATEGORIES = [
  "articles", "financial_statement", "budget", "energy_certificate", "floor_plan", "minutes", "meeting_notice",
  "contract", "condition_assessment", "maintenance_plan", "maintenance_needs_report", "manager_certificate", "photo", "insurance", "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  articles: "Yhtiöjärjestys",
  financial_statement: "Tilinpäätös",
  budget: "Talousarvio",
  energy_certificate: "Energiatodistus",
  floor_plan: "Pohjapiirustus",
  minutes: "Pöytäkirja",
  meeting_notice: "Kokouskutsu",
  contract: "Sopimus",
  condition_assessment: "Kuntoarvio",
  maintenance_plan: "Kunnossapitosuunnitelma",
  maintenance_needs_report: "Kunnossapitotarveselvitys",
  manager_certificate: "Isännöitsijäntodistus",
  photo: "Kuva",
  insurance: "Vakuutus",
  other: "Muu",
};

/** Käyttöliittymästä valittavat näkyvyydet. `provider` ja `reporter` ovat huoltomoduulin liitteille. */
export const SELECTABLE_VISIBILITIES = ["internal", "board", "owners", "residents"] as const;
export type SelectableVisibility = (typeof SELECTABLE_VISIBILITIES)[number];

export const VISIBILITY_LABEL: Record<string, string> = {
  internal: "Vain henkilökunta",
  board: "Hallitus",
  owners: "Osakkaat",
  residents: "Kaikki asukkaat",
  provider: "Palveluntuottaja",
  reporter: "Ilmoittaja",
};

export const VISIBILITY_TONE: Record<string, "neutral" | "info" | "ok" | "warn"> = {
  internal: "neutral",
  board: "info",
  owners: "warn",
  residents: "ok",
  provider: "neutral",
  reporter: "neutral",
};

export function formatBytes(bytes: number | string): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} t`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kt`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mt`;
}

/** Selaimen `accept`-attribuutti. Varsinainen tarkistus tehdään sisällöstä (`detectAllowedType`). */
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.docx";
