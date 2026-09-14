/**
 * Laskutusrivin maksaja. Vastikevastuu on osakkeenomistajilla yhteisesti,
 * mutta lasku lähetetään yhdelle: suurimman omistusosuuden haltijalle, ja
 * tasatilanteessa nimen mukaan aakkosjärjestyksessä ensimmäiselle.
 */
export interface OwnershipForBilling {
  party_id: string;
  display_name: string;
  share_numerator: number;
  share_denominator: number;
  starts_on: string | null;
  ends_on: string | null;
}

export function activeOn(o: Pick<OwnershipForBilling, "starts_on" | "ends_on">, date: string): boolean {
  return (o.starts_on === null || o.starts_on <= date) && (o.ends_on === null || o.ends_on >= date);
}

export function primaryPayer<T extends OwnershipForBilling>(ownerships: T[], date: string): T | null {
  const active = ownerships.filter((o) => activeOn(o, date));
  if (active.length === 0) return null;
  return [...active].sort((a, b) => {
    // a/b vs c/d ristiin kertomalla, jotta 1/3 ei pyöristy.
    const diff = b.share_numerator * a.share_denominator - a.share_numerator * b.share_denominator;
    return diff !== 0 ? diff : a.display_name.localeCompare(b.display_name, "fi");
  })[0];
}
