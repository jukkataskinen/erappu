/**
 * Muutostyöilmoitusten käsittely (asunto-osakeyhtiölaki 5 luku).
 *
 * Osakas ilmoittaa → yhtiö pyytää lisätietoja tai päättää (hyväksytty,
 * hyväksytty ehdoin, kielletty) → työ käynnissä → valmis. Valmistunut työ
 * siirtyy kunnossapito- ja muutostyöhistoriaan (osakkaan tekemä) ja sieltä
 * HTJ:hin.
 */

export type RenovationStatus = "received" | "info_requested" | "approved" | "approved_with_conditions" | "denied" | "in_progress" | "completed" | "cancelled";

export const RENOVATION_STATUS_LABEL: Record<RenovationStatus, string> = {
  received: "Vastaanotettu",
  info_requested: "Lisätietoja pyydetty",
  approved: "Hyväksytty",
  approved_with_conditions: "Hyväksytty ehdoin",
  denied: "Kielletty",
  in_progress: "Työ käynnissä",
  completed: "Valmis",
  cancelled: "Peruttu",
};

export const RENOVATION_STATUS_TONE: Record<RenovationStatus, "neutral" | "info" | "ok" | "warn" | "alert"> = {
  received: "alert",
  info_requested: "warn",
  approved: "info",
  approved_with_conditions: "info",
  denied: "neutral",
  in_progress: "info",
  completed: "ok",
  cancelled: "neutral",
};

const TRANSITIONS: Record<RenovationStatus, RenovationStatus[]> = {
  received: ["info_requested", "approved", "approved_with_conditions", "denied", "cancelled"],
  info_requested: ["approved", "approved_with_conditions", "denied", "cancelled"],
  approved: ["in_progress", "completed", "cancelled"],
  approved_with_conditions: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  denied: [],
  completed: [],
  cancelled: [],
};

export function nextStatuses(status: RenovationStatus): RenovationStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: RenovationStatus, to: RenovationStatus): boolean {
  return from === to || nextStatuses(from).includes(to);
}

/** Avoimet ilmoitukset odottavat yhtiön toimenpidettä. */
export const OPEN_FOR_COMPANY: RenovationStatus[] = ["received", "info_requested"];
/** Osakkaan näkökulmasta kesken olevat. */
export const OPEN_FOR_OWNER: RenovationStatus[] = ["received", "info_requested", "approved", "approved_with_conditions", "in_progress"];

export const DECISION_STATUSES: RenovationStatus[] = ["approved", "approved_with_conditions", "denied"];

export interface RenovationUpdate {
  status: RenovationStatus;
  conditions: string | null;
  supervisor: string | null;
  decidedOn: string | null;
  completedOn: string | null;
}

/**
 * Tarkistaa käsittelyn tiedot. Palauttaa virheilmoituksen tai null.
 * Ehdot ovat pakolliset, kun hyväksytään ehdoin; päätöspäivä täytetään
 * tarvittaessa tälle päivälle.
 */
export function validateRenovationUpdate(from: RenovationStatus, u: RenovationUpdate, today: string): { error: string } | { value: RenovationUpdate } {
  if (!canTransition(from, u.status)) {
    return { error: `Tilasta ${RENOVATION_STATUS_LABEL[from].toLowerCase()} ei voi siirtyä tilaan ${RENOVATION_STATUS_LABEL[u.status].toLowerCase()}.` };
  }
  if (u.status === "approved_with_conditions" && !u.conditions) return { error: "Kirjaa ehdot, kun muutostyö hyväksytään ehdoin." };
  const value = { ...u };
  if (DECISION_STATUSES.includes(u.status) && !value.decidedOn) value.decidedOn = today;
  if (u.status === "completed" && !value.completedOn) value.completedOn = today;
  if (value.decidedOn && value.completedOn && value.completedOn < value.decidedOn) return { error: "Valmistumispäivä ei voi olla ennen päätöspäivää." };
  return { value };
}
