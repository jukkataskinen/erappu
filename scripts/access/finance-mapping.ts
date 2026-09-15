/**
 * Access-talousviennin muunnokset ja tuonnin suunnitelma. Puhtaita funktioita,
 * testattu tests/unit/access-finance-mapping.test.ts.
 *
 * Accessissa on vastikkeista vain Vastikkeet-taulu (laji, hinta, muutospäivä)
 * ja lainoista yksi Lainat-rivi yhtiötä kohden (määrä, päivä, nostamattomat).
 * Lainanantajaa, korkoa, eräpäivää, lyhennystapaa ja lainaosuuksia ei ole
 * missään taulussa, joten niitä ei johdeta eikä arvata.
 */
import { addDays, isIsoDate } from "../../src/lib/finance/dates.ts";
import { CHARGE_TYPE_TO_HTJ } from "../../src/lib/finance/labels.ts";

export interface AccessChargeRow {
  ID: number;
  Yhtiö_id: number;
  Vastikelaji: string | null;
  Hoitovastike: number | null;
  HV_Muutos_pvn: string | null;
}

export interface AccessLoanRow {
  ID: number;
  YhtiöId: number;
  "Yhtiön laina": number | null;
  "Lainan pvm": string | null;
  "Nostamattomat lainat, eur": number | null;
  "Nostamattomat lainat, pvm": string | null;
}

export interface AccessFinanceCompany {
  ID: number;
  Yhtiö: string;
  "Yhtiön lainat": number | null;
  "Sama vastikeperuste": boolean | null;
  "Osakkeiden lukumäärä": number | null;
  "Pinta-ala": number | null;
  Huoneistoala: number | null;
}

export interface AccessFinanceUnit {
  ID: number;
  Yhtiö: number;
  Asunnon_nro: string | null;
  koko: number | null;
  osakkeiden_määrä: number | null;
  Käyttötarkoitus: string | null;
  "Hakeuduttu alv-velvolliseksi": boolean | null;
}

/** Access-päivä ISO-muotoon: viennin "2024-07-01" tai tekstikentän "20.7.2026". */
export function parseAccessDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (isIsoDate(text)) return text;
  const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(text);
  if (iso && isIsoDate(iso[1])) return iso[1];
  const fi = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (!fi) return null;
  const candidate = `${fi[3]}-${fi[2].padStart(2, "0")}-${fi[1].padStart(2, "0")}`;
  return isIsoDate(candidate) ? candidate : null;
}

/** Hinta kannan numeric(12,4)-muotoon. */
export function price4(value: number): string {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

export function euros2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Raportin euromäärä: 3780,67. */
export function fiEur(value: number): string {
  return euros2(value).replace(".", ",");
}

export interface ChargeKind {
  chargeType: string;
  basis: string;
  label: string;
  htjChargeType: string | null;
  /** Peruste on CLAUDE.md:n päätös (hoitovastike €/m²/kk), muille lajeille oletus. */
  basisKnown: boolean;
}

/** Accessin vastikelaji eRapun lajiksi. null = tuntematon laji. */
export function chargeKind(laji: string | null): ChargeKind | null {
  const l = (laji ?? "").trim().toLowerCase();
  if (!l) return null;
  const kind = (chargeType: string, label: string, basisKnown = false, basis = "area_m2"): ChargeKind => ({
    chargeType,
    basis,
    label,
    htjChargeType: CHARGE_TYPE_TO_HTJ[chargeType] ?? null,
    basisKnown,
  });
  if (l.includes("hoitovastike")) return kind("maintenance", "Hoitovastike", true);
  if (l.includes("rahoitusvastike")) return kind("financing", "Rahoitusvastike", false, "share");
  if (l.includes("pääomavastike")) return kind("capital", "Pääomavastike", false, "share");
  if (l.includes("lämmitys")) return kind("heating", "Lämmitysvastike");
  if (l.includes("maavastike") || l.includes("tontinvuokra")) return kind("land", "Maavastike");
  if (l.includes("vesi")) return kind("water", "Vesimaksu", false, "person");
  if (l.includes("sauna")) return kind("sauna", "Saunamaksu", false, "fixed");
  if (l.includes("autopaikka") || l.includes("autokatos") || l.includes("autotalli")) return kind("parking", "Autopaikkamaksu", false, "fixed");
  return null;
}

export interface DesiredBasis {
  accessId: number;
  chargeType: string;
  basis: string;
  label: string;
  htjChargeType: string | null;
  unitPrice: string;
  startsOn: string;
  endsOn: string | null;
}

/**
 * Yhtiön Vastikkeet-rivit voimassaolojaksoiksi. Saman lajin seuraava
 * muutospäivä päättää edellisen perusteen edeltävänä päivänä.
 */
export function mapCharges(rows: AccessChargeRow[], today: string): { bases: DesiredBasis[]; issues: string[] } {
  const issues: string[] = [];
  const byType = new Map<string, DesiredBasis[]>();

  for (const r of [...rows].sort((a, b) => a.ID - b.ID)) {
    const kind = chargeKind(r.Vastikelaji);
    const start = parseAccessDate(r.HV_Muutos_pvn);
    const lajiText = r.Vastikelaji?.trim() || "(laji puuttuu)";
    if (!kind) {
      issues.push(`Vastikerivi ${r.ID}: laji "${lajiText}" ei ole tunnettu vastikelaji, ei tuotu.`);
      continue;
    }
    if (r.Hoitovastike === null || !Number.isFinite(r.Hoitovastike) || r.Hoitovastike <= 0) {
      issues.push(`${kind.label} (rivi ${r.ID}): hinta ${r.Hoitovastike ?? "puuttuu"}${start ? `, alkaen ${start}` : ", ei päivää"}. Nollaa tai tyhjää perustetta ei tuotu.`);
      continue;
    }
    if (!start) {
      issues.push(`${kind.label} ${r.Hoitovastike} (rivi ${r.ID}): muutospäivä puuttuu, ei tuotu.`);
      continue;
    }
    if (!kind.basisKnown) {
      issues.push(`${kind.label} (rivi ${r.ID}): Accessissa ei ole laskentaperustetta, tuotiin oletuksella ${kind.basis}. Tarkista.`);
    }
    const list = byType.get(kind.chargeType) ?? [];
    const same = list.findIndex((b) => b.startsOn === start);
    const basis: DesiredBasis = { accessId: r.ID, chargeType: kind.chargeType, basis: kind.basis, label: kind.label, htjChargeType: kind.htjChargeType, unitPrice: price4(r.Hoitovastike), startsOn: start, endsOn: null };
    if (same >= 0) {
      issues.push(`${kind.label}: kaksi riviä samalla muutospäivällä ${start} (${trimPrice(list[same].unitPrice)} ja ${trimPrice(basis.unitPrice)} €). Tuotiin myöhemmin kirjattu (rivi ${r.ID}).`);
      list[same] = basis;
    } else {
      list.push(basis);
    }
    byType.set(kind.chargeType, list);
  }

  const bases: DesiredBasis[] = [];
  for (const list of byType.values()) {
    list.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    list.forEach((b, i) => {
      const next = list[i + 1];
      if (next) {
        b.endsOn = addDays(next.startsOn, -1);
        if (Number(next.unitPrice) < Number(b.unitPrice)) {
          issues.push(`${b.label} laski ${next.startsOn}: ${trimPrice(b.unitPrice)} → ${trimPrice(next.unitPrice)} €. Tarkista, onko muutos oikein (esim. ALV tai laskentaperusteen vaihto).`);
        }
      }
      bases.push(b);
    });
    const last = list[list.length - 1];
    if (last && Number(last.startsOn.slice(0, 4)) < Number(today.slice(0, 4)) - 3) {
      issues.push(`${last.label}: viimeisin muutos Accessissa ${last.startsOn} (${trimPrice(last.unitPrice)} €). Tarkista viimeisimmän talousarvion vastikepäätöksestä, onko hinta ajan tasalla.`);
    }
  }
  if (!bases.some((b) => b.chargeType === "maintenance")) {
    issues.push("Hoitovastiketta ei ole Accessissa. Lisää voimassa oleva hoitovastike talousarviosta ennen laskutusta ja HTJ2-ilmoitusta.");
  }
  return { bases, issues };
}

export function trimPrice(p: string): string {
  return p.replace(/\.?0+$/, "").replace(".", ",");
}

export interface DesiredLoan {
  accessId: number;
  name: string;
  balanceEur: string;
  balanceDate: string | null;
  undrawnEur: string;
  undrawnDate: string | null;
}

/**
 * Lainat-rivi lainaksi. Accessin lomakkeessa kenttä on "Yhtiön lainat" ja
 * sen vieressä "Lainan pvm": määrä on yhtiön lainojen saldo kyseisenä
 * päivänä, ei alkuperäinen pääoma eikä yksittäinen laina.
 */
export function mapLoans(rows: AccessLoanRow[], company: Pick<AccessFinanceCompany, "Yhtiön lainat"> | null): { loans: DesiredLoan[]; issues: string[] } {
  const issues: string[] = [];
  const loans: DesiredLoan[] = [];
  for (const r of [...rows].sort((a, b) => a.ID - b.ID)) {
    const amount = r["Yhtiön laina"];
    const rawDate = r["Lainan pvm"];
    const date = parseAccessDate(rawDate);
    const undrawn = r["Nostamattomat lainat, eur"] ?? 0;
    const undrawnDate = parseAccessDate(r["Nostamattomat lainat, pvm"]);
    if (rawDate && !date) issues.push(`Lainarivi ${r.ID}: päivä "${rawDate}" ei ole päivämäärä.`);
    if (amount === null || amount <= 0) {
      if (date) issues.push(`Lainat-rivillä saldo 0 € päivällä ${date}. Laina on ilmeisesti maksettu pois; lainaa ei tuotu.`);
      if (undrawn > 0) issues.push(`Nostamattomia lainoja ${fiEur(undrawn)} €, mutta saldo 0 €. Ei tuotu, lisää käsin, jos laina on nostamatta.`);
      continue;
    }
    if (!date) issues.push(`Laina ${fiEur(amount)} €: saldon päivä puuttuu. Lisää päivä tilinpäätöksestä.`);
    if (undrawn > 0 && !undrawnDate) issues.push(`Nostamattomat lainat ${fiEur(undrawn)} €: arviopäivä puuttuu.`);
    loans.push({ accessId: r.ID, name: "Yhtiölaina", balanceEur: euros2(amount), balanceDate: date, undrawnEur: euros2(undrawn), undrawnDate });
  }
  if (loans.length > 1) issues.push(`Accessissa on ${loans.length} lainariviä samalle yhtiölle. Kaikki tuotiin omina lainoinaan; tarkista, ovatko ne eri lainoja.`);

  const legacy = company?.["Yhtiön lainat"] ?? null;
  const total = loans.reduce((s, l) => s + Number(l.balanceEur), 0);
  if (legacy !== null && legacy > 0 && Math.abs(legacy - total) >= 0.01) {
    issues.push(`Yhtiöt-taulun vanha kenttä "Yhtiön lainat" on ${fiEur(legacy)} €, Lainat-taulussa ${fiEur(total)} €. Vanhaa kenttää ei tuotu; tarkista tilinpäätöksestä, onko yhtiöllä lainaa.`);
  }
  return { loans, issues };
}

export interface CompanyTotals {
  unitArea: number;
  unitShares: number;
  issues: string[];
}

/** Summatarkistukset, joihin vastikkeen ja lainaosuuksien laskenta nojaa. */
export function checkCompanyTotals(company: AccessFinanceCompany, units: AccessFinanceUnit[]): CompanyTotals {
  const issues: string[] = [];
  const unitArea = Math.round(units.reduce((s, u) => s + (u.koko ?? 0), 0) * 10) / 10;
  const unitShares = units.reduce((s, u) => s + (u.osakkeiden_määrä ?? 0), 0);
  const area = company.Huoneistoala ?? company["Pinta-ala"];
  if (area !== null && area > 0 && Math.abs(area - unitArea) > 0.5) {
    issues.push(`Accessissa osakeryhmien pinta-alat yhteensä ${formatNum(unitArea)} m², yhtiön huoneistoala ${formatNum(area)} m². Hoitovastike lasketaan osakeryhmien pinta-aloista.`);
  }
  const noArea = units.filter((u) => !u.koko);
  if (noArea.length) issues.push(`Pinta-ala puuttuu: ${noArea.map((u) => u.Asunnon_nro ?? `?${u.ID}`).join(", ")}. Näille ei muodostu hoitovastiketta.`);
  const shares = company["Osakkeiden lukumäärä"];
  if (shares !== null && shares > 0 && shares !== unitShares) {
    issues.push(`Accessissa osakeryhmien osakkeet yhteensä ${unitShares}, yhtiön osakemäärä ${shares}. Lainaosuudet jaetaan osakkeiden suhteessa, joten korjaa ennen lainaosuuksien laskentaa.`);
  }
  const vat = units.filter((u) => u["Hakeuduttu alv-velvolliseksi"]);
  if (vat.length) issues.push(`ALV-velvolliseksi hakeutuneita osakeryhmiä: ${vat.map((u) => u.Asunnon_nro).join(", ")}. eRapussa ALV on vastikeperusteen tieto; tarkista.`);
  return { unitArea, unitShares, issues };
}

function formatNum(n: number): string {
  return String(n).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Tuonnin suunnitelma: mitä kannassa muutetaan
// ---------------------------------------------------------------------------

export interface ExistingBasis {
  id: string;
  charge_type: string;
  basis: string;
  unit_price: string;
  starts_on: string;
  ends_on: string | null;
  label: string | null;
  htj_charge_type: string | null;
  applies_to_kinds: string[] | null;
  source: string;
  /** Laskutusrivit viittaavat perusteeseen. */
  referenced: boolean;
}

export type BasisOp =
  | { op: "insert"; desired: DesiredBasis }
  | { op: "update"; id: string; desired: DesiredBasis; changes: string[] }
  | { op: "keep"; id: string; desired: DesiredBasis }
  | { op: "delete"; id: string; existing: ExistingBasis }
  | { op: "retain"; id: string; existing: ExistingBasis; reason: string };

const samePrice = (a: string, b: string) => Number(a).toFixed(4) === Number(b).toFixed(4);

/**
 * Vastikeperusteiden synkronointi. Vain Access-tuonnin rivejä (source
 * 'migration') päivitetään tai poistetaan. Käsin syötetty peruste voittaa:
 * sen alkupäivästä eteenpäin Accessin perusteita ei tuoda, ja edellinen
 * Access-peruste päätetään sitä edeltävänä päivänä.
 */
export function planChargeSync(existing: ExistingBasis[], desiredIn: DesiredBasis[]): { ops: BasisOp[]; notes: string[] } {
  const notes: string[] = [];
  const ops: BasisOp[] = [];
  const manual = existing.filter((e) => e.source !== "migration");
  const migrated = existing.filter((e) => e.source === "migration");

  const desired: DesiredBasis[] = [];
  const types = [...new Set(desiredIn.map((d) => d.chargeType))];
  for (const type of types) {
    const list = desiredIn.filter((d) => d.chargeType === type).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const manualStart = manual
      .filter((m) => m.charge_type === type)
      .map((m) => m.starts_on)
      .sort()[0];
    if (!manualStart) {
      desired.push(...list);
      continue;
    }
    const before = list.filter((d) => d.startsOn < manualStart).map((d) => ({ ...d }));
    const dropped = list.length - before.length;
    if (dropped) notes.push(`${list[0].label}: käsin syötetty peruste alkaen ${manualStart} korvaa ${dropped} Access-perustetta.`);
    const last = before[before.length - 1];
    if (last && (last.endsOn === null || last.endsOn >= manualStart)) {
      last.endsOn = addDays(manualStart, -1);
      notes.push(`${last.label} ${last.startsOn}: päätetään ${last.endsOn}, koska käsin syötetty peruste alkaa ${manualStart}.`);
    }
    desired.push(...before);
  }

  const used = new Set<string>();
  for (const d of desired) {
    const match = migrated.find((e) => !used.has(e.id) && e.charge_type === d.chargeType && e.starts_on === d.startsOn);
    if (!match) {
      ops.push({ op: "insert", desired: d });
      continue;
    }
    used.add(match.id);
    const changes: string[] = [];
    if (!samePrice(match.unit_price, d.unitPrice)) changes.push(`hinta ${trimPrice(Number(match.unit_price).toFixed(4))} → ${trimPrice(d.unitPrice)}`);
    if ((match.ends_on ?? null) !== d.endsOn) changes.push(`päättyy ${match.ends_on ?? "-"} → ${d.endsOn ?? "-"}`);
    if (match.basis !== d.basis) changes.push(`peruste ${match.basis} → ${d.basis}`);
    if ((match.label ?? null) !== d.label) changes.push(`nimi → ${d.label}`);
    if ((match.htj_charge_type ?? null) !== d.htjChargeType) changes.push(`HTJ-laji → ${d.htjChargeType ?? "-"}`);
    if (match.applies_to_kinds && match.applies_to_kinds.length) changes.push("kohdistus kaikkiin osakeryhmiin");
    ops.push(changes.length ? { op: "update", id: match.id, desired: d, changes } : { op: "keep", id: match.id, desired: d });
  }
  for (const e of migrated.filter((m) => !used.has(m.id))) {
    if (e.referenced) {
      ops.push({ op: "retain", id: e.id, existing: e, reason: "laskutusrivit viittaavat perusteeseen" });
      notes.push(`Access-peruste ${e.charge_type} ${e.starts_on} ei ole enää Accessissa, mutta laskutus viittaa siihen. Jätettiin, tarkista.`);
    } else {
      ops.push({ op: "delete", id: e.id, existing: e });
    }
  }
  return { ops, notes };
}

export interface ExistingLoan {
  id: string;
  name: string;
  principal_eur: string;
  balance_eur: string | null;
  balance_date: string | null;
  undrawn_eur: string;
  undrawn_estimated_on: string | null;
  purpose: string | null;
  allocated: boolean;
  source: string;
  share_count: number;
  billed: boolean;
}

export interface LoanFields {
  name: string;
  principal_eur: string;
  balance_eur: string;
  balance_date: string | null;
  undrawn_eur: string;
  undrawn_estimated_on: string | null;
  purpose: string | null;
  allocated: boolean;
}

export type LoanOp =
  | { op: "insert"; desired: DesiredLoan; fields: LoanFields }
  | { op: "update"; id: string; desired: DesiredLoan; fields: LoanFields; changes: string[] }
  | { op: "keep"; id: string; desired: DesiredLoan }
  | { op: "delete"; id: string; existing: ExistingLoan }
  | { op: "retain"; id: string; existing: ExistingLoan; reason: string }
  | { op: "skip"; desired: DesiredLoan; reason: string };

/** Ensimmäisen Access-tuonnin (import-access.mts) tunnisteet, jotka siivotaan. */
const LEGACY_NAME = "Yhtiölaina (Access)";
const LEGACY_PURPOSE = /^Accessin päivämäärä /;

const sameMoney = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a).toFixed(2) === Number(b).toFixed(2));

/**
 * Lainojen synkronointi. Jaettavuus: Accessissa ei ole rahoitusvastiketta
 * yhdelläkään lainalliselle yhtiölle, joten laina on tuotu ei-jaettavana
 * (maksetaan hoitovastikkeesta). Jos lainaosuuksia on jo laskettu, jaettavuus
 * ja pääoma jätetään käyttäjän tiedoiksi.
 */
export function planLoanSync(existing: ExistingLoan[], desired: DesiredLoan[]): { ops: LoanOp[]; notes: string[] } {
  const notes: string[] = [];
  const ops: LoanOp[] = [];
  const manual = existing.filter((e) => e.source !== "migration");
  const migrated = existing.filter((e) => e.source === "migration");
  const used = new Set<string>();

  for (const d of desired) {
    const match = migrated.find((e) => !used.has(e.id));
    if (!match) {
      if (manual.length) {
        const reason = `yhtiöllä on käsin syötetty laina (${manual.map((m) => m.name).join(", ")})`;
        ops.push({ op: "skip", desired: d, reason });
        notes.push(`Accessin laina ${d.balanceEur} € jätettiin tuomatta, koska ${reason}. Tarkista, onko se sama laina.`);
        continue;
      }
      ops.push({
        op: "insert",
        desired: d,
        fields: { name: d.name, principal_eur: d.balanceEur, balance_eur: d.balanceEur, balance_date: d.balanceDate, undrawn_eur: d.undrawnEur, undrawn_estimated_on: d.undrawnDate, purpose: null, allocated: false },
      });
      continue;
    }
    used.add(match.id);
    const hasShares = match.share_count > 0;
    const principalFollowsBalance = match.balance_eur === null || sameMoney(match.principal_eur, match.balance_eur);
    const fields: LoanFields = {
      name: match.name === LEGACY_NAME ? d.name : match.name,
      principal_eur: principalFollowsBalance && !hasShares ? d.balanceEur : match.principal_eur,
      balance_eur: d.balanceEur,
      balance_date: d.balanceDate,
      undrawn_eur: d.undrawnEur,
      undrawn_estimated_on: d.undrawnDate,
      purpose: match.purpose && LEGACY_PURPOSE.test(match.purpose) ? null : match.purpose,
      allocated: hasShares ? match.allocated : false,
    };
    const changes: string[] = [];
    if (fields.name !== match.name) changes.push(`nimi → ${fields.name}`);
    if (!sameMoney(fields.principal_eur, match.principal_eur)) changes.push(`pääoma ${match.principal_eur} → ${fields.principal_eur}`);
    if (!sameMoney(fields.balance_eur, match.balance_eur)) changes.push(`saldo ${match.balance_eur ?? "-"} → ${fields.balance_eur}`);
    if (fields.balance_date !== match.balance_date) changes.push(`saldopäivä ${match.balance_date ?? "-"} → ${fields.balance_date ?? "-"}`);
    if (!sameMoney(fields.undrawn_eur, match.undrawn_eur)) changes.push(`nostamatta ${match.undrawn_eur} → ${fields.undrawn_eur}`);
    if (fields.undrawn_estimated_on !== match.undrawn_estimated_on) changes.push(`nostamattomien päivä → ${fields.undrawn_estimated_on ?? "-"}`);
    if (fields.purpose !== match.purpose) changes.push("käyttötarkoitus tyhjennetään (vanhan tuonnin päivämerkintä)");
    if (fields.allocated !== match.allocated) changes.push(fields.allocated ? "jaettava" : "ei jaettava");
    if (hasShares) notes.push(`Laina ${fields.name}: lainaosuuksia on ${match.share_count}, joten pääomaa ja jaettavuutta ei muutettu.`);
    ops.push(changes.length ? { op: "update", id: match.id, desired: d, fields, changes } : { op: "keep", id: match.id, desired: d });
  }
  for (const e of migrated.filter((m) => !used.has(m.id))) {
    if (e.share_count > 0 || e.billed) {
      const reason = e.share_count > 0 ? "lainalla on lainaosuuksia" : "laskutusrivit viittaavat lainaan";
      ops.push({ op: "retain", id: e.id, existing: e, reason });
      notes.push(`Access-tuonnin laina ${e.name} ei ole enää Accessissa, mutta ${reason}. Jätettiin, tarkista.`);
    } else {
      ops.push({ op: "delete", id: e.id, existing: e });
    }
  }
  return { ops, notes };
}
