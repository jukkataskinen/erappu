/** Huoltopyyntöjen suomenkieliset nimet ja värisävyt. Ei palvelinriippuvuuksia. */

export const STATUSES = ["new", "received", "ordered", "in_progress", "waiting", "done", "closed", "rejected"] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const URGENCIES = ["urgent", "normal", "low"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const CATEGORIES = [
  "plumbing", "water_damage", "electrical", "heating", "ventilation", "doors_locks",
  "appliances", "structures", "yard", "cleaning", "pests", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const COST_RESPONSIBILITIES = ["company", "shareholder", "unclear"] as const;
export type CostResponsibility = (typeof COST_RESPONSIBILITIES)[number];

export const VISIBILITIES = ["internal", "reporter", "provider", "board"] as const;
export type EventVisibility = (typeof VISIBILITIES)[number];

export type Tone = "neutral" | "info" | "ok" | "warn" | "alert";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "Uusi",
  received: "Vastaanotettu",
  ordered: "Tilattu",
  in_progress: "Työn alla",
  waiting: "Odottaa",
  done: "Valmis",
  closed: "Suljettu",
  rejected: "Hylätty",
};

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  new: "alert",
  received: "info",
  ordered: "info",
  in_progress: "info",
  waiting: "warn",
  done: "ok",
  closed: "neutral",
  rejected: "neutral",
};

export const URGENCY_LABEL: Record<Urgency, string> = { urgent: "Kiireellinen", normal: "Normaali", low: "Ei kiirettä" };
export const URGENCY_TONE: Record<Urgency, Tone> = { urgent: "alert", normal: "neutral", low: "neutral" };

export const CATEGORY_LABEL: Record<Category, string> = {
  plumbing: "Vesi ja viemäri",
  water_damage: "Vesivahinko tai vuoto",
  electrical: "Sähkö ja valaistus",
  heating: "Lämmitys",
  ventilation: "Ilmanvaihto",
  doors_locks: "Ovet, lukot ja avaimet",
  appliances: "Kodinkoneet",
  structures: "Rakenteet, ikkunat ja katto",
  yard: "Piha ja ulkoalueet",
  cleaning: "Siivous ja jätehuolto",
  pests: "Tuholaiset",
  other: "Muu",
};

export const COST_LABEL: Record<CostResponsibility, string> = {
  company: "Yhtiö",
  shareholder: "Osakas",
  unclear: "Selvitettävä",
};

export const VISIBILITY_LABEL: Record<EventVisibility, string> = {
  internal: "Vain henkilökunta",
  reporter: "Ilmoittaja ja hallitus",
  provider: "Palveluntuottaja",
  board: "Hallitus",
};

export const SOURCE_LABEL: Record<string, string> = { staff: "Henkilökunta", portal: "Portaali", public_form: "Julkinen lomake" };

export const EVENT_TYPE_LABEL: Record<string, string> = {
  comment: "Kommentti",
  status_change: "Tilamuutos",
  attachment: "Kuva",
  notification: "Ilmoitus",
  assignment: "Käsittely",
  cost: "Kustannus",
  marketplace: "Tori",
};
