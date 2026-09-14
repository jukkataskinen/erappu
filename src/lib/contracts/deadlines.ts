import { addDays, addMonths, diffDays, type IsoDate } from "@/lib/tasks/dates";

/**
 * Sopimuksen irtisanomisen määräajat.
 *
 * Irtisanomisen viimeinen päivä = päättymispäivä miinus irtisanomisaika.
 * Kuukauden viimeinen päivä säilyy (päättyy 31.12., 3 kk → 30.9.).
 * Muistutus lähtee oletuksena 30 päivää ennen viimeistä päivää, jotta
 * hallitus ehtii päättää jatkosta.
 */

export const DEFAULT_REMINDER_DAYS = 30;
export const ENDING_SOON_DAYS = 90;

export function noticeDeadline(endsOn: IsoDate | null, noticeMonths: number | null): IsoDate | null {
  if (!endsOn || noticeMonths === null || noticeMonths === undefined) return null;
  return addMonths(endsOn, -noticeMonths, { keepMonthEnd: true });
}

export function defaultReminderOn(endsOn: IsoDate | null, noticeMonths: number | null): IsoDate | null {
  const deadline = noticeDeadline(endsOn, noticeMonths);
  if (deadline) return addDays(deadline, -DEFAULT_REMINDER_DAYS);
  return endsOn ? addDays(endsOn, -DEFAULT_REMINDER_DAYS) : null;
}

export type ContractStatus = "active" | "ending" | "ended";

export interface ContractTiming {
  deadline: IsoDate | null;
  daysToDeadline: number | null;
  daysToEnd: number | null;
  /** Päättyminen tai irtisanomisen viimeinen päivä 90 päivän sisällä. */
  endingSoon: boolean;
  /** Irtisanomisaika on jo mennyt, sopimus jatkuu tai päättyy ehtojensa mukaan. */
  noticePassed: boolean;
  effectiveStatus: ContractStatus;
}

export function contractTiming(c: { ends_on: IsoDate | null; notice_months: number | null; status: ContractStatus }, today: IsoDate): ContractTiming {
  const deadline = noticeDeadline(c.ends_on, c.notice_months);
  const daysToDeadline = deadline ? diffDays(today, deadline) : null;
  const daysToEnd = c.ends_on ? diffDays(today, c.ends_on) : null;
  const ended = c.status === "ended" || (daysToEnd !== null && daysToEnd < 0);
  const within = (d: number | null) => d !== null && d >= 0 && d <= ENDING_SOON_DAYS;
  return {
    deadline,
    daysToDeadline,
    daysToEnd,
    endingSoon: !ended && (within(daysToDeadline) || within(daysToEnd)),
    noticePassed: !ended && daysToDeadline !== null && daysToDeadline < 0,
    effectiveStatus: ended ? "ended" : c.status,
  };
}
