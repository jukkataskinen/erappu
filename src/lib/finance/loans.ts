import { compareUnitLabels } from "./references";
import { roundDiv } from "./money";

/**
 * Yhtiölainan jako osakeryhmille osakkeiden suhteessa.
 *
 * Jokainen osuus pyöristetään alaspäin senttiin, ja jäännössentit annetaan
 * yksi kerrallaan suurimmille osakeryhmille (tasatilanteessa tunnuksen
 * järjestyksessä). Näin osuudet summautuvat täsmälleen lainan määrään, mitä
 * HTJ-ilmoitus ja tilinpäätöksen lainaosuuserittely edellyttävät.
 */
export interface ShareHolding {
  id: string;
  unit_label: string;
  share_count: number;
}

export function allocateByShares(totalCents: bigint, groups: ShareHolding[]): Map<string, bigint> {
  const eligible = groups.filter((g) => g.share_count > 0);
  const result = new Map<string, bigint>();
  if (eligible.length === 0) return result;
  if (totalCents < 0n) throw new Error("Lainan määrä ei voi olla negatiivinen");
  const totalShares = BigInt(eligible.reduce((s, g) => s + g.share_count, 0));

  let allocated = 0n;
  for (const g of eligible) {
    const part = (totalCents * BigInt(g.share_count)) / totalShares;
    result.set(g.id, part);
    allocated += part;
  }
  let residue = totalCents - allocated;
  const order = [...eligible].sort((a, b) => b.share_count - a.share_count || compareUnitLabels(a.unit_label, b.unit_label));
  for (let i = 0; residue > 0n; i = (i + 1) % order.length) {
    result.set(order[i].id, result.get(order[i].id)! + 1n);
    residue -= 1n;
  }
  return result;
}

/** Kuukausia jäljellä kauden alusta lainan eräpäivään (vähintään 1). */
export function monthsRemaining(fromDate: string, dueOn: string): number {
  if (dueOn < fromDate) return 1;
  const months = (Number(dueOn.slice(0, 4)) - Number(fromDate.slice(0, 4))) * 12 + (Number(dueOn.slice(5, 7)) - Number(fromDate.slice(5, 7))) + 1;
  return Math.max(1, months);
}

/**
 * Rahoitusvastike lainaosuudesta tasalyhenteisenä ilman korkoa:
 * jäljellä oleva osuus / jäljellä olevat kuukaudet. Korko ja pankin
 * maksuohjelma eivät ole eRapussa, joten tämä on laskelma, jonka
 * isännöitsijä tarkistaa ennen hyväksyntää.
 */
export function financingChargeCents(remainingCents: bigint, periodStart: string, loanDueOn: string): bigint {
  if (remainingCents <= 0n) return 0n;
  return roundDiv(remainingCents, BigInt(monthsRemaining(periodStart, loanDueOn)));
}

/** Kertasuorituksen tai lyhennyksen jälkeen jäljellä oleva osuus ei voi olla negatiivinen. */
export function remainingAfterPayment(remainingCents: bigint, paymentCents: bigint): bigint {
  const r = remainingCents - paymentCents;
  return r < 0n ? 0n : r;
}

/** Täydet kuukaudet päivästä `from` päivään `to` (0, jos `to` ei ole myöhemmin). */
export function fullMonthsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  if (Number(to.slice(8, 10)) < Number(from.slice(8, 10))) months -= 1;
  return Math.max(0, months);
}

/**
 * Arvio lainaosuudesta maksupäivänä: saldopäivän osuudesta vähennetään
 * tasalyhennys jokaiselta täydeltä kuukaudelta ennen maksupäivää. Pankin
 * maksuohjelmaa ei ole eRapussa, joten lopullinen kertasuoritus
 * tarkistetaan maksupäivän saldosta.
 */
export function estimatedRemainingCents(remainingCents: bigint, balanceDate: string, payDate: string, loanDueOn: string | null): { cents: bigint; months: number; estimated: boolean } {
  const months = fullMonthsBetween(balanceDate, payDate);
  if (months === 0 || !loanDueOn || remainingCents <= 0n) return { cents: remainingCents, months: 0, estimated: false };
  const monthly = financingChargeCents(remainingCents, balanceDate, loanDueOn);
  const left = remainingCents - monthly * BigInt(months);
  return { cents: left < 0n ? 0n : left, months, estimated: true };
}
