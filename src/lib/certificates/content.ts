/**
 * Isännöitsijäntodistuksen johdetut tiedot. Puhtaita funktioita, jotta
 * laskentasäännöt (yhteenvedot, asbestihuomautus, kiinteistötunnuksen osat)
 * voidaan testata ilman kantaa.
 */

import { BASIS, LOAN_TYPE } from "@/lib/finance/labels";
import { CHARGE_TYPE } from "./charges";
import { formatDate, formatEuro } from "@/documents/format";

/** Rakennukset ennen tätä vuotta: purettavissa materiaaleissa voi olla asbestia (käyttökielto 1994). */
export const ASBESTOS_YEAR_LIMIT = 1994;

export const ASBESTOS_NOTE =
  "Yhtiön rakennus on valmistunut ennen vuotta 1994. Rakennusmateriaaleissa voi olla asbestia tai muita haitta-aineita, joten purettavien materiaalien asbesti- ja haitta-ainekartoitus on tehtävä ennen purku- ja muutostöitä.";

/** Energiatodistus on voimassa enintään kymmenen vuotta laatimisesta (laki rakennuksen energiatodistuksesta 50/2013, 8 §). */
export const ENERGY_CERTIFICATE_VALID_YEARS = 10;

/**
 * Huomautus vanhentuneesta energiatodistuksesta. Laatimisesta tiedetään usein
 * vain vuosi: yli kymmenen vuotta vanha todistus on varmasti vanhentunut,
 * täsmälleen kymmenen vuoden ikäinen voi olla vanhentunut. Tuntematon vuosi → null.
 */
export function energyCertificateValidityNote(year: number | null, currentYear: number): string | null {
  if (year === null) return null;
  const age = currentYear - year;
  if (age > ENERGY_CERTIFICATE_VALID_YEARS) {
    return `Energiatodistus on laadittu vuonna ${year}, joten se on yli ${ENERGY_CERTIFICATE_VALID_YEARS} vuotta vanha ja vanhentunut (laki rakennuksen energiatodistuksesta 50/2013, 8 §). Todistuksen tiedot eivät välttämättä enää päde.`;
  }
  if (age === ENERGY_CERTIFICATE_VALID_YEARS) {
    return `Energiatodistus on laadittu vuonna ${year}. Todistus on voimassa enintään ${ENERGY_CERTIFICATE_VALID_YEARS} vuotta laatimisesta (laki 50/2013, 8 §), joten se voi olla jo vanhentunut eivätkä tiedot välttämättä enää päde.`;
  }
  return null;
}

/** Omistusosuus murtolukuna; koko osakeryhmä → "1/1". */
export function ownershipShareText(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`;
}

/** Asbestihuomautus, jos jokin rakennus on valmistunut ennen vuotta 1994. Tuntematon vuosi ei laukaise huomautusta. */
export function asbestosNote(buildings: { completed_year: number | null }[]): string | null {
  return buildings.some((b) => b.completed_year !== null && b.completed_year < ASBESTOS_YEAR_LIMIT) ? ASBESTOS_NOTE : null;
}

/**
 * Kiinteistötunnuksen osat (kunta-sijaintialue-ryhmä-yksikkö). Asemakaava-alueella
 * sijaintialue on kaupunginosa, ryhmä kortteli ja yksikkö tontti; muualla kylä,
 * talo ja tila. Tunnistamaton muoto → null.
 */
export function parsePropertyCode(code: string): { municipality: string; area: string; group: string; unit: string } | null {
  const m = /^(\d{1,3})-(\d{1,3})-(\d{1,4})-(\d{1,4})$/.exec(code.trim());
  if (!m) return null;
  return { municipality: m[1], area: m[2], group: m[3], unit: m[4] };
}

export interface BuildingSummaryInput {
  apartment_area_m2: string | number | null;
  floor_area_m2: string | number | null;
  volume_m3: string | number | null;
  staircases: number | null;
  elevators: number | null;
}

const sumKnown = (values: (string | number | null)[]) => {
  const known = values.filter((v) => v !== null && v !== "").map(Number);
  return known.length ? known.reduce((s, v) => s + v, 0) : null;
};

export function buildingSummary(buildings: BuildingSummaryInput[]) {
  return {
    count: buildings.length,
    apartmentAreaM2: sumKnown(buildings.map((b) => b.apartment_area_m2)),
    floorAreaM2: sumKnown(buildings.map((b) => b.floor_area_m2)),
    volumeM3: sumKnown(buildings.map((b) => b.volume_m3)),
    staircases: sumKnown(buildings.map((b) => b.staircases)),
    elevators: buildings.reduce((s, b) => s + (b.elevators ?? 0), 0),
  };
}

export interface SpaceInput {
  kind: string;
  area_m2: string | number | null;
  share_count: number;
  company_possession: boolean;
}

export const SPACE_KIND_LABEL: Record<string, string> = {
  apartment: "Asuinhuoneistot",
  commercial: "Liikehuoneistot",
  parking: "Autopaikat",
  garage: "Autotallit",
  storage: "Varastot",
  other: "Muut tilat",
};

const SPACE_ORDER = ["apartment", "commercial", "garage", "parking", "storage", "other"];

/** Tilaluettelo tyypeittäin: kappaleet, pinta-ala, osakkeet ja yhtiön hallinnassa olevat. */
export function spacesByKind(groups: SpaceInput[]) {
  const map = new Map<string, { kind: string; label: string; count: number; areaM2: number; shares: number; companyPossession: number }>();
  for (const g of groups) {
    const row = map.get(g.kind) ?? { kind: g.kind, label: SPACE_KIND_LABEL[g.kind] ?? g.kind, count: 0, areaM2: 0, shares: 0, companyPossession: 0 };
    row.count += 1;
    row.areaM2 += Number(g.area_m2 ?? 0);
    row.shares += g.share_count;
    if (g.company_possession) row.companyPossession += 1;
    map.set(g.kind, row);
  }
  return [...map.values()].sort((a, b) => SPACE_ORDER.indexOf(a.kind) - SPACE_ORDER.indexOf(b.kind));
}

export interface PriceListInput {
  charge_type: string;
  label: string | null;
  basis: string;
  unit_price: string | number;
  vat_percent?: string | number | null;
}

/** Yhtiön kaikki voimassa olevat vastikkeet ja käyttökorvaukset hinnastona. */
export function chargePriceList(bases: PriceListInput[]) {
  return bases.map((b) => {
    const price = Number(b.unit_price);
    const decimals = b.basis === "share" ? 4 : 2;
    const unit = b.basis === "fixed" ? "€/kk" : `€/${BASIS[b.basis]?.unit ?? b.basis}/kk`;
    return {
      product: b.label?.trim() || CHARGE_TYPE[b.charge_type] || b.charge_type,
      unitPrice: `${price.toFixed(decimals).replace(".", ",")} ${unit}`,
      vat: b.vat_percent !== null && b.vat_percent !== undefined && Number(b.vat_percent) > 0 ? `alv ${String(Number(b.vat_percent)).replace(".", ",")} %` : "",
    };
  });
}

const pct = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : `${String(Number(v)).replace(".", ",")} %`);

export interface LoanInput {
  name: string;
  lender: string | null;
  loan_type: string | null;
  principal_eur: string;
  balance_eur: string | null;
  balance_date: string | null;
  drawn_on: string | null;
  due_on: string | null;
  reference_rate: string | null;
  margin_percent: string | null;
  interest_percent: string | null;
  interest_terms: string | null;
  undrawn_eur: string | null;
  undrawn_estimated_on: string | null;
  purpose: string | null;
  allocated: boolean;
}

/** Lainan rivi todistukseen: korko kootaan viitekorosta, marginaalista ja/tai kokonaiskorosta. */
export function loanRow(l: LoanInput) {
  const interest = [
    l.reference_rate ? `${l.reference_rate}${pct(l.margin_percent) ? ` + ${pct(l.margin_percent)}` : ""}` : pct(l.margin_percent) ? `marginaali ${pct(l.margin_percent)}` : null,
    pct(l.interest_percent) ? `korko ${pct(l.interest_percent)}` : null,
    l.interest_terms,
  ].filter(Boolean).join(", ");
  const undrawn = Number(l.undrawn_eur ?? 0);
  return {
    name: l.name,
    type: l.loan_type ? LOAN_TYPE[l.loan_type] ?? l.loan_type : "–",
    lender: l.lender ?? "–",
    purpose: l.purpose ?? "–",
    drawnOn: formatDate(l.drawn_on),
    principal: formatEuro(l.principal_eur),
    interest: interest || "–",
    dueOn: formatDate(l.due_on),
    balance: formatEuro(l.balance_eur ?? l.principal_eur),
    balanceDate: formatDate(l.balance_date),
    undrawn: undrawn > 0 ? `${formatEuro(undrawn)}${l.undrawn_estimated_on ? `, nostetaan arviolta ${formatDate(l.undrawn_estimated_on)}` : ""}` : null,
    payable: l.allocated ? "Kyllä" : "Ei",
  };
}

/** Kyllä/Ei/Ei tiedossa kolmitilaiselle arvolle. */
export function yesNo(value: boolean | null | undefined, unknown = "Ei tiedossa"): string {
  return value === true ? "Kyllä" : value === false ? "Ei" : unknown;
}

export const SPOUSES_HOME_LABEL: Record<string, string> = { yes: "Kyllä", no: "Ei", unknown: "Ei tiedossa" };

export const PURPOSE_LABEL: Record<string, string> = {
  bank: "Pankkia varten",
  sale: "Kauppaa varten",
  rental: "Vuokrausta varten",
  other: "Muu",
};

export function purposeText(purpose: string | null, text: string | null): string | null {
  if (!purpose) return null;
  if (purpose === "other") return text?.trim() || "Muu";
  return PURPOSE_LABEL[purpose] ?? null;
}
