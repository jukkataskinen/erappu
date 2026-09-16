/**
 * Osakeryhmän kuukausivastikkeet voimassa olevista vastikeperusteista
 * isännöitsijäntodistusta varten.
 *
 * Laskutus (M3) on vastikkeiden varsinainen lähde; tämä on todistuksen
 * arvio samoista perusteista: €/m² × pinta-ala, €/osake × osakkeet,
 * kiinteä tai huoneistokohtainen sellaisenaan. Kulutukseen (henkilö, mittari)
 * perustuvaa vastiketta ei voi laskea, joten siitä näytetään yksikköhinta.
 */

export interface ChargeBasisInput {
  charge_type: string;
  label: string | null;
  basis: string;
  unit_price: string | number;
  applies_to_kinds: string[] | null;
}

export interface ShareGroupInput {
  kind: string;
  area_m2: string | number | null;
  share_count: number;
}

export interface ComputedCharge {
  label: string;
  basisText: string;
  monthlyEur: number | null;
}

export const CHARGE_TYPE: Record<string, string> = {
  maintenance: "Hoitovastike",
  land: "Maavastike",
  heating: "Lämmitysvastike",
  capital: "Pääomavastike",
  financing: "Rahoitusvastike",
  water: "Vesimaksu",
  hot_water: "Lämmin vesi",
  sauna: "Saunamaksu",
  parking: "Autopaikkamaksu",
  other: "Muu maksu",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, decimals = 2) => n.toFixed(decimals).replace(".", ",");

export function computeMonthlyCharges(bases: ChargeBasisInput[], group: ShareGroupInput): { charges: ComputedCharge[]; totalEur: number } {
  const charges: ComputedCharge[] = [];
  for (const b of bases) {
    if (b.applies_to_kinds && b.applies_to_kinds.length > 0 && !b.applies_to_kinds.includes(group.kind)) continue;
    const price = Number(b.unit_price);
    const label = b.label?.trim() || CHARGE_TYPE[b.charge_type] || b.charge_type;
    const area = group.area_m2 === null || group.area_m2 === "" ? null : Number(group.area_m2);
    switch (b.basis) {
      case "area_m2":
        charges.push({ label, basisText: `${fmt(price, 2)} €/m²/kk`, monthlyEur: area === null ? null : round2(price * area) });
        break;
      case "share":
        charges.push({ label, basisText: `${fmt(price, 4)} €/osake/kk`, monthlyEur: round2(price * group.share_count) });
        break;
      case "unit":
      case "fixed":
        charges.push({ label, basisText: b.basis === "unit" ? "€/huoneisto/kk" : "kiinteä €/kk", monthlyEur: round2(price) });
        break;
      default:
        charges.push({ label, basisText: `${fmt(price, 2)} € / ${b.basis === "person" ? "henkilö" : "kulutuksen mukaan"}`, monthlyEur: null });
    }
  }
  const totalEur = round2(charges.reduce((s, c) => s + (c.monthlyEur ?? 0), 0));
  return { charges, totalEur };
}
