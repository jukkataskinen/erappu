import type { RequestStatus } from "./labels";

/**
 * Huoltopyynnön tilasiirtymät. Puhdasta logiikkaa, jotta säännöt voi testata
 * ilman kantaa. Kanta varmistaa lisäksi roolirajat (RLS, triggeri ja
 * ilmoittajan funktio), mutta käyttöliittymän napit ja palvelintoiminnot
 * nojaavat näihin.
 */

export const OPEN_STATUSES: readonly RequestStatus[] = ["new", "received", "ordered", "in_progress", "waiting"];
export const FINISHED_STATUSES: readonly RequestStatus[] = ["done", "closed", "rejected"];

export function isOpen(status: RequestStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Tila, johon uudelleen avattu pyyntö palaa. */
export const REOPEN_STATUS: RequestStatus = "received";

const STAFF_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  new: ["received", "ordered", "in_progress", "waiting", "done", "closed", "rejected"],
  received: ["ordered", "in_progress", "waiting", "done", "closed", "rejected"],
  ordered: ["received", "in_progress", "waiting", "done", "closed", "rejected"],
  in_progress: ["ordered", "waiting", "done", "closed"],
  waiting: ["ordered", "in_progress", "done", "closed", "rejected"],
  // Valmiin voi sulkea tai palauttaa työn alle (lasketaan uudelleenavaukseksi).
  done: ["closed", "in_progress", REOPEN_STATUS],
  // Suljettu ja hylätty avataan vain uudelleenavauksella.
  closed: [REOPEN_STATUS],
  rejected: [REOPEN_STATUS],
};

export function staffTransitions(from: RequestStatus): readonly RequestStatus[] {
  return STAFF_TRANSITIONS[from];
}

export function canStaffTransition(from: RequestStatus, to: RequestStatus): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

/** Onko siirtymä uudelleenavaus (kanta kasvattaa laskuria samalla säännöllä). */
export function isReopen(from: RequestStatus, to: RequestStatus): boolean {
  return FINISHED_STATUSES.includes(from) && !FINISHED_STATUSES.includes(to);
}

export type ProviderAction = "acknowledge" | "start" | "complete";

/**
 * Palveluntuottajan kuittaukset tehtävälinkistä. Palauttaa uuden tilan,
 * saman tilan (kuittaus ilman tilamuutosta) tai null, jos toiminto ei ole
 * sallittu. Suljettuun, hylättyyn tai valmiiseen ei voi enää kuitata.
 */
export function providerTransition(from: RequestStatus, action: ProviderAction): RequestStatus | null {
  if (!["ordered", "received", "in_progress", "waiting"].includes(from)) return null;
  switch (action) {
    case "acknowledge":
      return from === "in_progress" || from === "waiting" ? null : from;
    case "start":
      return from === "in_progress" ? null : "in_progress";
    case "complete":
      return "done";
  }
}

export type ReporterAction = "close" | "reopen";

/** Ilmoittajan toiminnot portaalissa. Sama sääntö kuin kannan funktiossa. */
export function reporterTransition(from: RequestStatus, action: ReporterAction): RequestStatus | null {
  if (action === "close") return from === "done" ? "closed" : null;
  return from === "done" || from === "closed" ? REOPEN_STATUS : null;
}

/** Myöhässä: avoin pyyntö, jonka määräaika on ennen tätä päivää (ISO-päivinä). */
export function isOverdue(dueOn: string | null, status: RequestStatus, todayIso: string): boolean {
  if (!dueOn || !isOpen(status)) return false;
  return dueOn.slice(0, 10) < todayIso;
}

/** Ilmoitetaanko tilamuutoksesta ilmoittajalle. Omasta toiminnosta ei ilmoiteta. */
export function notifyReporterOfStatus(to: RequestStatus, byReporter: boolean): boolean {
  if (byReporter) return false;
  return to !== "new";
}
