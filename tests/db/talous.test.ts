import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { approveBillingRun, createBillingRun, ensureUnitNumbers, FinanceError, loadMatchCandidates, savePaymentImport } from "@/lib/finance/billing";
import { addChargeBasis, recalculateLoanShares } from "@/lib/finance/registers";
import { matchPaymentRows, parsePaymentCsv } from "@/lib/finance/payment-import";
import { companyReference } from "@/lib/finance/references";
import { isValidReferenceNumber } from "@/lib/validation/finnish";
import { boardCompanyFinance, ownerUnitFinance } from "@/lib/finance/portal";
import { financeOverview } from "@/lib/finance/queries";

let db: Database;
let f: Fixture;
let owner1: { id: string; sub: string };
let owner2: { id: string; sub: string };
let tenant: { id: string; sub: string };
let board: { id: string; sub: string };
let g1: string;
let g2: string;
let runId: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner1 = await createUser(db);
  owner2 = await createUser(db);
  tenant = await createUser(db);
  board = await createUser(db);

  await db.asService(async (tx) => {
    g1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1',72.5) returning id", [f.orgA, f.companyA])).id;
    g2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 2',50) returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,143),($1,$2,$4,144,241)", [f.orgA, f.companyA, g1, g2]);
    const party = async (last: string, userId: string | null) =>
      (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, user_id) values ($1,$2,$3) returning id", [f.orgA, last, userId])).id;
    const p1 = await party("Öhman", owner1.id);
    const p2 = await party("Laine", owner2.id);
    const pOther = await party("Aalto", null);
    const pt = await party("Vuokralainen", tenant.id);
    await tx.query(
      "insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, source) values ($1,$2,$3,1,2,'manual'),($1,$2,$6,1,2,'manual'),($1,$4,$5,1,1,'manual')",
      [f.orgA, g1, p1, g2, p2, pOther],
    );
    await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,'tenant')", [f.orgA, g2, pt]);
    await tx.query(
      `insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values
         ($1,$2,$3,$4,'owner','t1'), ($1,$5,$3,$6,'owner','t2'), ($1,$7,$3,$6,'resident','t3'), ($1,$8,$3,null,'board','t4')`,
      [f.orgA, owner1.id, f.companyA, g1, owner2.id, g2, tenant.id, board.id],
    );
  });
});
afterAll(async () => db.close());

describe("vastikeperusteet ja laskutus (kirjanpitäjä)", () => {
  it("uusi peruste päättää edellisen automaattisesti", async () => {
    await db.asUser(f.accountantA.sub, async (tx) => {
      await addChargeBasis(tx, {
        companyId: f.companyA, chargeType: "maintenance", label: null, basis: "area_m2", unitPrice: "3.0000", vatPercent: "0",
        appliesToKinds: null, startsOn: "2025-01-01", decidedOn: "2024-11-20", decisionNote: "Yhtiökokous", htjChargeType: "hoitovastike",
      });
      const r = await addChargeBasis(tx, {
        companyId: f.companyA, chargeType: "maintenance", label: null, basis: "area_m2", unitPrice: "3.1500", vatPercent: "0",
        appliesToKinds: null, startsOn: "2026-09-01", decidedOn: "2026-05-20", decisionNote: null, htjChargeType: "hoitovastike",
      });
      expect(r.ended).toBe(1);
      const rows = await tx.query<{ unit_price: string; ends_on: string | null }>(
        "select unit_price::text, ends_on::text from er_charge_bases where company_id = $1 order by starts_on",
        [f.companyA],
      );
      expect(rows).toEqual([{ unit_price: "3.0000", ends_on: "2026-08-31" }, { unit_price: "3.1500", ends_on: null }]);
    });

    await expect(
      db.asUser(f.accountantA.sub, (tx) =>
        addChargeBasis(tx, {
          companyId: f.companyA, chargeType: "maintenance", label: null, basis: "area_m2", unitPrice: "3.2", vatPercent: "0",
          appliesToKinds: null, startsOn: "2026-09-01", decidedOn: null, decisionNote: null, htjChargeType: null,
        }),
      ),
    ).rejects.toBeInstanceOf(FinanceError);
  });

  it("laskutusajo vaatii asetukset", async () => {
    await expect(db.asUser(f.accountantA.sub, (tx) => createBillingRun(tx, { companyId: f.companyA, month: "2026-09", userId: f.accountantA.id }))).rejects.toThrow(/laskutusasetukset/);
  });

  it("luo ajon: rivit osakeryhmittäin, maksaja ja kelvolliset viitteet", async () => {
    await db.asUser(f.accountantA.sub, (tx) =>
      tx.query("insert into er_company_billing_settings (organization_id, company_id, company_number, bank_iban) values ($1,$2,12,'FI2112345600000785')", [f.orgA, f.companyA]),
    );
    const res = await db.asUser(f.accountantA.sub, (tx) => createBillingRun(tx, { companyId: f.companyA, month: "2026-09", userId: f.accountantA.id }));
    runId = res.runId;
    expect(res.totals.total_eur).toBe("385.88");

    const lines = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ unit_label: string; amount_eur: string; reference_number: string; payer: string | null }>(
        `select g.unit_label, l.amount_eur::text, l.reference_number, p.last_name as payer
           from er_billing_lines l join er_share_groups g on g.id = l.share_group_id left join er_parties p on p.id = l.payer_party_id
          where l.run_id = $1 order by g.unit_label`,
        [runId],
      ),
    );
    expect(lines).toEqual([
      { unit_label: "A 1", amount_eur: "228.38", reference_number: companyReference(12, 1), payer: "Aalto" },
      { unit_label: "A 2", amount_eur: "157.50", reference_number: companyReference(12, 2), payer: "Laine" },
    ]);
    for (const l of lines) expect(isValidReferenceNumber(l.reference_number)).toBe(true);

    await expect(db.asUser(f.accountantA.sub, (tx) => createBillingRun(tx, { companyId: f.companyA, month: "2026-09", userId: f.accountantA.id }))).rejects.toThrow(/jo laskutusajo/);
  });

  it("järjestysnumerot säilyvät, kun yhtiöön lisätään huoneisto", async () => {
    await db.asService((tx) => tx.query("insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 0',30)", [f.orgA, f.companyA]));
    const numbers = await db.asUser(f.accountantA.sub, (tx) => ensureUnitNumbers(tx, f.companyA));
    expect(numbers.get(g1)).toBe(1);
    expect(numbers.get(g2)).toBe(2);
    expect([...numbers.values()].sort()).toEqual([1, 2, 3]);
  });

  it("lainaosuudet osakkeiden suhteessa summautuvat lainaan", async () => {
    const loanId = await db.asUser(f.accountantA.sub, async (tx) => {
      const [loan] = await tx.query<{ id: string }>(
        "insert into er_loans (organization_id, company_id, name, principal_eur, balance_eur) values ($1,$2,'Kattolaina',100000.01,80000.00) returning id",
        [f.orgA, f.companyA],
      );
      await recalculateLoanShares(tx, loan.id, f.companyA, "2026-09-14");
      return loan.id;
    });
    const sums = await db.asUser(f.accountantA.sub, (tx) =>
      one<{ o: string; r: string; n: number }>(tx, "select sum(original_eur)::text o, sum(remaining_eur)::text r, count(*)::int n from er_loan_shares where loan_id = $1", [loanId]),
    );
    expect(sums).toEqual({ o: "100000.01", r: "80000.00", n: 2 });
  });

  it("maksutilanteen tuonti kohdistaa viitteellä ja nollaa puuttuvat", async () => {
    await db.asUser(f.accountantA.sub, async (tx) => {
      const parsed = parsePaymentCsv(`﻿Viitenumero;Avoin;Erääntynyt;Vanhin eräpäivä\n${companyReference(12, 1)};228,38;228,38;5.9.2026\n${companyReference(12, 999)};1,00;0;\n`);
      const m = matchPaymentRows(parsed.rows, await loadMatchCandidates(tx, f.companyA));
      expect(m.unmatched).toHaveLength(1);
      await savePaymentImport(tx, { companyId: f.companyA, fileName: "reskontra.csv", asOf: "2026-09-14", rowCount: parsed.rows.length, matched: m.matched, unmatched: m.unmatched, userId: f.accountantA.id });
    });
    const status = await db.asUser(f.managerA.sub, (tx) =>
      tx.query<{ unit_label: string; open_eur: string; overdue_eur: string }>(
        "select g.unit_label, s.open_eur::text, s.overdue_eur::text from er_payment_status s join er_share_groups g on g.id = s.share_group_id order by g.unit_label",
      ),
    );
    expect(status).toEqual([
      { unit_label: "A 0", open_eur: "0.00", overdue_eur: "0.00" },
      { unit_label: "A 1", open_eur: "228.38", overdue_eur: "228.38" },
      { unit_label: "A 2", open_eur: "0.00", overdue_eur: "0.00" },
    ]);
  });
});

describe("yhteenveto", () => {
  it("talouden yhtiölista laskee kertymän, saatavat ja lainat", async () => {
    const [row] = await db.asUser(f.managerA.sub, (tx) => financeOverview(tx, f.orgA, "2026-09-14"));
    expect(row).toMatchObject({ maintenanceRate: "3.1500", monthlyAccrual: "480.38", openEur: "228.38", overdueEur: "228.38", currentRunDone: true, hasSettings: true, loansEur: "80000.00" });
    expect(await db.asUser(f.managerB.sub, (tx) => financeOverview(tx, f.orgA, "2026-09-14"))).toEqual([]);
  });
});

describe("RLS", () => {
  const tables = ["er_billing_runs", "er_billing_lines", "er_company_billing_settings", "er_billing_unit_numbers", "er_payment_status", "er_payment_imports"];

  it("toinen organisaatio ei näe talouden rivejä eikä voi kirjoittaa", async () => {
    for (const t of tables) {
      const rows = await db.asUser(f.managerB.sub, (tx) => tx.query(`select id from ${t}`));
      expect(rows, t).toHaveLength(0);
    }
    const upd = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_billing_runs set status = 'approved' where id = $1 returning id", [runId]));
    expect(upd).toHaveLength(0);
    await expect(
      db.asUser(f.managerB.sub, (tx) =>
        tx.query("insert into er_company_billing_settings (organization_id, company_id, company_number) values ($1,$2,77)", [f.orgA, f.companyA]),
      ),
    ).rejects.toThrow(/row-level security/);
    const summary = await db.asUser(f.managerB.sub, (tx) => tx.query("select * from er_board_payment_summary($1)", [f.companyA]));
    expect(summary).toHaveLength(0);
  });

  it("osakas ei näe luonnosajon rivejä", async () => {
    const rows = await db.asUser(owner1.sub, (tx) => tx.query("select id from er_billing_lines"));
    expect(rows).toHaveLength(0);
  });

  it("osakas näkee hyväksytystä ajosta vain oman osakeryhmänsä rivit ja maksutilanteen", async () => {
    const ok = await db.asUser(f.managerA.sub, (tx) => approveBillingRun(tx, runId, f.companyA, f.managerA.id));
    expect(ok).toBe(true);

    const lines = await db.asUser(owner1.sub, (tx) => tx.query<{ share_group_id: string }>("select share_group_id from er_billing_lines"));
    expect(lines.map((l) => l.share_group_id)).toEqual([g1]);
    const status = await db.asUser(owner1.sub, (tx) => tx.query<{ share_group_id: string }>("select share_group_id from er_payment_status"));
    expect(status.map((s) => s.share_group_id)).toEqual([g1]);
    const settings = await db.asUser(owner1.sub, (tx) => tx.query<{ bank_iban: string }>("select bank_iban from er_company_billing_settings"));
    expect(settings).toEqual([{ bank_iban: "FI2112345600000785" }]);
    const runs = await db.asUser(owner1.sub, (tx) => tx.query("select id from er_billing_runs"));
    expect(runs).toHaveLength(0);
    const imports = await db.asUser(owner1.sub, (tx) => tx.query("select id from er_payment_imports"));
    expect(imports).toHaveLength(0);
  });

  it("asukas (vuokralainen) ei näe vastikerivejä eikä maksutilannetta", async () => {
    expect(await db.asUser(tenant.sub, (tx) => tx.query("select id from er_billing_lines"))).toHaveLength(0);
    expect(await db.asUser(tenant.sub, (tx) => tx.query("select id from er_payment_status"))).toHaveLength(0);
  });

  it("hallitus näkee ajon summat mutta ei osakkaiden henkilörivejä", async () => {
    const runs = await db.asUser(board.sub, (tx) => tx.query<{ totals: { total_eur: string } }>("select totals from er_billing_runs"));
    expect(runs.map((r) => r.totals.total_eur)).toEqual(["385.88"]);
    expect(await db.asUser(board.sub, (tx) => tx.query("select id from er_billing_lines"))).toHaveLength(0);
    expect(await db.asUser(board.sub, (tx) => tx.query("select id from er_payment_status"))).toHaveLength(0);
    const [summary] = await db.asUser(board.sub, (tx) =>
      tx.query<{ open_eur: string; overdue_units: number; units: number }>("select open_eur::text, overdue_units, units from er_board_payment_summary($1)", [f.companyA]),
    );
    expect(summary).toEqual({ open_eur: "228.38", overdue_units: 1, units: 3 });
    // Osakas ei ole hallituksessa: ei yhtiön summia.
    expect(await db.asUser(owner2.sub, (tx) => tx.query("select * from er_board_payment_summary($1)", [f.companyA]))).toHaveLength(0);
  });

  it("portaalin talousnäkymät toimivat osakkaan ja hallituksen oikeuksilla", async () => {
    const grants = [{ companyId: f.companyA, companyName: "As Oy Testi A", role: "owner" as const, shareGroupId: g1, unitLabel: "A 1", providerId: null }];
    const [unit] = await db.asUser(owner1.sub, (tx) => ownerUnitFinance(tx, grants, "2026-09-14"));
    expect(unit.monthlyTotal).toBe("228.38");
    expect(unit.reference).toBe(companyReference(12, 1));
    expect(unit.iban).toBe("FI2112345600000785");
    expect(unit.lastBilled?.periodStart).toBe("2026-09-01");
    expect(unit.lastBilled?.total).toBe("228.38");
    expect(unit.loanShares).toHaveLength(1);
    expect(unit.payment?.overdueEur).toBe("228.38");

    // Toisen osakkaan osakeryhmää ei saa, vaikka tunniste annettaisiin.
    const foreign = await db.asUser(owner1.sub, (tx) => ownerUnitFinance(tx, [{ ...grants[0], shareGroupId: g2 }], "2026-09-14"));
    expect(foreign).toHaveLength(0);

    const b = await db.asUser(board.sub, (tx) => boardCompanyFinance(tx, { id: f.companyA, name: "As Oy Testi A" }, "2026-09-14"));
    expect(b.bases).toHaveLength(1);
    expect(b.loans[0].shares_remaining).toBe("80000.00");
    expect(b.runs).toHaveLength(1);
    expect(b.payment?.overdue_units).toBe(1);
  });

  it("toinen osakas näkee vain omansa", async () => {
    const lines = await db.asUser(owner2.sub, (tx) => tx.query<{ share_group_id: string }>("select share_group_id from er_billing_lines"));
    expect(lines.map((l) => l.share_group_id)).toEqual([g2]);
  });
});
