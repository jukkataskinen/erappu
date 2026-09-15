import { describe, expect, it } from "vitest";
import {
  chargeKind,
  checkCompanyTotals,
  mapCharges,
  mapLoans,
  parseAccessDate,
  planChargeSync,
  planLoanSync,
  trimPrice,
  type AccessChargeRow,
  type AccessLoanRow,
  type DesiredBasis,
  type ExistingBasis,
  type ExistingLoan,
} from "../../scripts/access/finance-mapping";

// Keksittyä dataa, ei Accessin rivejä.
const charge = (ID: number, Vastikelaji: string | null, Hoitovastike: number | null, HV_Muutos_pvn: string | null): AccessChargeRow => ({ ID, Yhtiö_id: 1, Vastikelaji, Hoitovastike, HV_Muutos_pvn });
const loan = (ID: number, amount: number | null, date: string | null, undrawn = 0, undrawnDate: string | null = null): AccessLoanRow => ({
  ID,
  YhtiöId: 1,
  "Yhtiön laina": amount,
  "Lainan pvm": date,
  "Nostamattomat lainat, eur": undrawn,
  "Nostamattomat lainat, pvm": undrawnDate,
});
const basis = (over: Partial<ExistingBasis>): ExistingBasis => ({
  id: "b1",
  charge_type: "maintenance",
  basis: "area_m2",
  unit_price: "2.0000",
  starts_on: "2020-01-01",
  ends_on: null,
  label: "Hoitovastike",
  htj_charge_type: "hoitovastike",
  applies_to_kinds: null,
  source: "migration",
  referenced: false,
  ...over,
});
const existingLoan = (over: Partial<ExistingLoan>): ExistingLoan => ({
  id: "l1",
  name: "Yhtiölaina",
  principal_eur: "1000.00",
  balance_eur: "1000.00",
  balance_date: "2024-01-01",
  undrawn_eur: "0.00",
  undrawn_estimated_on: null,
  purpose: null,
  allocated: false,
  source: "migration",
  share_count: 0,
  billed: false,
  ...over,
});

describe("Access-talousviennin muunnokset", () => {
  it("päivät tekstistä ja viennistä", () => {
    expect(parseAccessDate("2024-07-01")).toBe("2024-07-01");
    expect(parseAccessDate("5.3.2025")).toBe("2025-03-05");
    expect(parseAccessDate("31.12.2023")).toBe("2023-12-31");
    expect(parseAccessDate("31.2.2023")).toBeNull();
    expect(parseAccessDate("kesällä")).toBeNull();
    expect(parseAccessDate(null)).toBeNull();
  });

  it("vastikelajit", () => {
    expect(chargeKind("Hoitovastike")).toMatchObject({ chargeType: "maintenance", basis: "area_m2", htjChargeType: "hoitovastike", basisKnown: true });
    expect(chargeKind("rahoitusvastike")).toMatchObject({ chargeType: "financing", htjChargeType: "paaomavastike", basisKnown: false });
    expect(chargeKind("Saunamaksu")).toMatchObject({ chargeType: "sauna", htjChargeType: null });
    expect(chargeKind("")).toBeNull();
    expect(chargeKind("Joulukinkku")).toBeNull();
  });

  it("hoitovastikkeen muutokset voimassaolojaksoiksi", () => {
    const { bases, issues } = mapCharges([charge(3, "Hoitovastike", 2.5, "2023-07-01"), charge(1, "Hoitovastike", 2, "2019-01-01")], "2026-09-15");
    expect(bases).toEqual([
      expect.objectContaining({ unitPrice: "2.0000", startsOn: "2019-01-01", endsOn: "2023-06-30", chargeType: "maintenance", label: "Hoitovastike" }),
      expect.objectContaining({ unitPrice: "2.5000", startsOn: "2023-07-01", endsOn: null }),
    ]);
    expect(issues).toEqual([]);
  });

  it("nolla, puuttuva päivä, tuntematon laji ja vanha hinta raportoidaan", () => {
    const { bases, issues } = mapCharges(
      [charge(1, "Rahoitusvastike", 0, null), charge(2, "Hoitovastike", 1.5, null), charge(3, "Hoitovastike", 3, "2015-01-01"), charge(4, null, 1, "2015-01-01"), charge(5, "Hoitovastike", 2, "2016-01-01")],
      "2026-09-15",
    );
    expect(bases.map((b) => b.unitPrice)).toEqual(["3.0000", "2.0000"]);
    expect(issues.some((i) => i.includes("Rahoitusvastike (rivi 1)"))).toBe(true);
    expect(issues.some((i) => i.includes("muutospäivä puuttuu"))).toBe(true);
    expect(issues.some((i) => i.includes("(laji puuttuu)"))).toBe(true);
    expect(issues.some((i) => i.includes("laski 2016-01-01"))).toBe(true);
    expect(issues.some((i) => i.includes("viimeisin muutos Accessissa 2016-01-01"))).toBe(true);
  });

  it("sama muutospäivä kahdesti: myöhemmin kirjattu voittaa", () => {
    const { bases, issues } = mapCharges([charge(7, "Hoitovastike", 2.2, "2025-01-01"), charge(9, "Hoitovastike", 2.4, "2025-01-01")], "2026-01-01");
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({ accessId: 9, unitPrice: "2.4000" });
    expect(issues[0]).toContain("kaksi riviä");
  });

  it("ilman hoitovastiketta huomautus", () => {
    expect(mapCharges([], "2026-01-01").issues[0]).toContain("Hoitovastiketta ei ole");
  });

  it("laina: saldo ja päivä, nollalaina ei tule", () => {
    const { loans, issues } = mapLoans([loan(1, 12345, "20.7.2026")], { "Yhtiön lainat": null });
    expect(loans).toEqual([{ accessId: 1, name: "Yhtiölaina", balanceEur: "12345.00", balanceDate: "2026-07-20", undrawnEur: "0.00", undrawnDate: null }]);
    expect(issues).toEqual([]);

    const zero = mapLoans([loan(2, 0, "30.6.2022")], { "Yhtiön lainat": 1500.5 });
    expect(zero.loans).toEqual([]);
    expect(zero.issues[0]).toContain("maksettu pois");
    expect(zero.issues[1]).toContain("1500,50 €");
  });

  it("laina ilman päivää ja nostamattomat ilman arviopäivää", () => {
    const { loans, issues } = mapLoans([loan(1, 5000, null, 200)], null);
    expect(loans[0]).toMatchObject({ balanceDate: null, undrawnEur: "200.00" });
    expect(issues.join(" ")).toContain("saldon päivä puuttuu");
    expect(issues.join(" ")).toContain("arviopäivä puuttuu");
  });

  it("summatarkistukset", () => {
    const company = { ID: 1, Yhtiö: "As Oy Esimerkki", "Yhtiön lainat": null, "Sama vastikeperuste": true, "Osakkeiden lukumäärä": 100, "Pinta-ala": 100, Huoneistoala: 100 };
    const units = [
      { ID: 1, Yhtiö: 1, Asunnon_nro: "A1", koko: 60, osakkeiden_määrä: 60, Käyttötarkoitus: "Asuinhuoneisto", "Hakeuduttu alv-velvolliseksi": false },
      { ID: 2, Yhtiö: 1, Asunnon_nro: "A2", koko: null, osakkeiden_määrä: 30, Käyttötarkoitus: "Asuinhuoneisto", "Hakeuduttu alv-velvolliseksi": true },
    ];
    const r = checkCompanyTotals(company, units);
    expect(r.unitArea).toBe(60);
    expect(r.unitShares).toBe(90);
    expect(r.issues).toHaveLength(4);
    expect(checkCompanyTotals(company, [{ ...units[0], koko: 100, osakkeiden_määrä: 100 }]).issues).toEqual([]);
  });

  it("hinta raporttiin", () => {
    expect(trimPrice("3.1500")).toBe("3,15");
    expect(trimPrice("10.0000")).toBe("10");
  });
});

describe("tuonnin suunnitelma", () => {
  const desired = (over: Partial<DesiredBasis>): DesiredBasis => ({
    accessId: 1,
    chargeType: "maintenance",
    basis: "area_m2",
    label: "Hoitovastike",
    htjChargeType: "hoitovastike",
    unitPrice: "2.0000",
    startsOn: "2020-01-01",
    endsOn: null,
    ...over,
  });

  it("vastikkeet: lisää, päivitä, jätä ennalleen ja poista vain tuonnin rivit", () => {
    const existing = [
      basis({ id: "same", starts_on: "2020-01-01", ends_on: "2020-01-01" }),
      basis({ id: "gone", starts_on: "2018-01-01", ends_on: "2019-12-31" }),
      basis({ id: "billed", starts_on: "2017-01-01", ends_on: "2017-12-31", referenced: true }),
      basis({ id: "hand", charge_type: "sauna", source: "manual", starts_on: "2021-01-01" }),
    ];
    const { ops } = planChargeSync(existing, [desired({ endsOn: "2022-12-31" }), desired({ accessId: 2, startsOn: "2023-01-01", unitPrice: "2.5000" })]);
    expect(ops.map((o) => o.op)).toEqual(["update", "insert", "delete", "retain"]);
    expect(ops[0]).toMatchObject({ id: "same", changes: ["päättyy 2020-01-01 → 2022-12-31"] });
    expect(ops.find((o) => o.op === "delete")).toMatchObject({ id: "gone" });
    expect(ops.some((o) => "id" in o && o.id === "hand")).toBe(false);
  });

  it("vastikkeet: toinen ajo ei muuta mitään", () => {
    const d = [desired({ endsOn: "2022-12-31" }), desired({ startsOn: "2023-01-01", unitPrice: "2.5000" })];
    const existing = [basis({ id: "a", ends_on: "2022-12-31" }), basis({ id: "b", starts_on: "2023-01-01", unit_price: "2.50" })];
    expect(planChargeSync(existing, d).ops.map((o) => o.op)).toEqual(["keep", "keep"]);
  });

  it("vastikkeet: käsin syötetty peruste katkaisee Accessin", () => {
    const existing = [basis({ id: "m", source: "manual", starts_on: "2025-07-01", unit_price: "3.0000" })];
    const { ops, notes } = planChargeSync(existing, [desired({ endsOn: "2025-12-31" }), desired({ startsOn: "2026-01-01", unitPrice: "2.8000" })]);
    expect(ops).toEqual([{ op: "insert", desired: expect.objectContaining({ startsOn: "2020-01-01", endsOn: "2025-06-30" }) }]);
    expect(notes).toHaveLength(2);
  });

  const d1 = { accessId: 1, name: "Yhtiölaina", balanceEur: "800.00", balanceDate: "2025-06-30", undrawnEur: "0.00", undrawnDate: null };

  it("lainat: uusi laina ei-jaettavana, saldo pääomaksi", () => {
    const { ops } = planLoanSync([], [d1]);
    expect(ops[0]).toMatchObject({ op: "insert", fields: { principal_eur: "800.00", balance_eur: "800.00", balance_date: "2025-06-30", allocated: false } });
  });

  it("lainat: vanhan tuonnin rivi siivotaan ja päivitetään", () => {
    const old = existingLoan({ name: "Yhtiölaina (Access)", balance_date: null, purpose: "Accessin päivämäärä 30.6.2025 (merkitys tarkistettava)", allocated: true });
    const { ops } = planLoanSync([old], [d1]);
    expect(ops[0]).toMatchObject({ op: "update", fields: { name: "Yhtiölaina", principal_eur: "800.00", purpose: null, allocated: false } });
  });

  it("lainat: käyttäjän pääoma ja lainaosuudet säilyvät", () => {
    const edited = existingLoan({ principal_eur: "5000.00", balance_eur: "1000.00", share_count: 3, allocated: true });
    const { ops, notes } = planLoanSync([edited], [d1]);
    expect(ops[0]).toMatchObject({ op: "update", fields: { principal_eur: "5000.00", allocated: true, balance_eur: "800.00" } });
    expect(notes[0]).toContain("lainaosuuksia on 3");
  });

  it("lainat: käsin syötetty laina estää tuonnin, poistunut tuonti poistetaan", () => {
    const manual = existingLoan({ id: "m", source: "manual", name: "Peruskorjauslaina" });
    expect(planLoanSync([manual], [d1]).ops[0]).toMatchObject({ op: "skip" });
    expect(planLoanSync([existingLoan({})], []).ops[0]).toMatchObject({ op: "delete", id: "l1" });
    expect(planLoanSync([existingLoan({ billed: true })], []).ops[0]).toMatchObject({ op: "retain" });
  });

  it("lainat: toinen ajo ei muuta mitään", () => {
    const same = existingLoan({ principal_eur: "800.00", balance_eur: "800.00", balance_date: "2025-06-30" });
    expect(planLoanSync([same], [d1]).ops.map((o) => o.op)).toEqual(["keep"]);
  });
});
