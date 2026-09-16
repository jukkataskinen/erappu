/**
 * Torin puhtaat säännöt (ei kantaa), päätökset Jukka 17.9.2026:
 * varaus viikon, toteuttajan tuntihinta, tuntiarvio yhtiön euro-rajaa vasten.
 */

export const RESERVATION_DAYS = 7;
/** Torilinkin voimassaolo. Uusi linkki mitätöi edellisen. */
export const MARKETPLACE_LINK_DAYS = 365;
/** Arvioitu toteutuspäivä enintään näin pitkälle, jotta viikon varaus on uskottava. */
export const MAX_ESTIMATE_DAYS_AHEAD = 60;

export type ListingStatus = "open" | "pending_approval" | "reserved" | "completed" | "cancelled";

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  open: "Torilla",
  pending_approval: "Varaus odottaa hyväksyntää",
  reserved: "Varattu",
  completed: "Tehty",
  cancelled: "Poistettu torilta",
};

export const ACTIVE_LISTING_STATUSES: ListingStatus[] = ["open", "pending_approval", "reserved"];

export function estimateEur(hours: number, hourlyRateEur: number): number {
  return Math.round(hours * hourlyRateEur * 100) / 100;
}

/** Ylittääkö arvio yhtiön hallituksen päättämän rajan. Raja on aina asetettu, kun tori on käytössä (kannan tarkistus). */
export function needsApproval(estimate: number, limitEur: number): boolean {
  return estimate > limitEur;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type ReservationInput = { estimatedOn: string; estimatedHours: number };

/** Varaajan antamien tietojen tarkistus. Palauttaa virheen suomeksi tai null. */
export function validateReservation(input: { estimatedOn: string; estimatedHours: number }, todayIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.estimatedOn)) return "Anna arvioitu toteutuspäivä.";
  if (input.estimatedOn < todayIso) return "Arvioitu toteutuspäivä ei voi olla menneisyydessä.";
  if (input.estimatedOn > addDays(todayIso, MAX_ESTIMATE_DAYS_AHEAD)) return `Arvioidun toteutuspäivän on oltava ${MAX_ESTIMATE_DAYS_AHEAD} päivän sisällä.`;
  if (!Number.isFinite(input.estimatedHours) || input.estimatedHours <= 0) return "Anna tuntiarvio.";
  if (input.estimatedHours > 500) return "Tuntiarvio on liian suuri. Ota yhteyttä isännöintiin.";
  if (Math.round(input.estimatedHours * 10) !== input.estimatedHours * 10) return "Anna tuntiarvio puolen tunnin tai kymmenyksen tarkkuudella.";
  return null;
}

/** Varauksen päättymishetki: viikko varauksesta. */
export function reservationExpiry(reservedAt: Date): Date {
  return new Date(reservedAt.getTime() + RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}

/** Torin yleiskuvaus, jonka isännöitsijä voi muokata. Pyynnön otsikkoa ei käytetä, koska siinä voi olla henkilötietoja. */
export function defaultSummary(categoryLabel: string): string {
  return `${categoryLabel}: `;
}
