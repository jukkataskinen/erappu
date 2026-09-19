/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { recalculateLoanShares } from "@/lib/finance/registers";
import { applyClosingBalances, loadStatementData, saveChargeStatement, saveLoanPeriod } from "@/lib/finance/statement-data";
import { buildLoanStatementsData } from "@/lib/finance/statement-document";
import { renderDocumentPdf } from "@/documents/render";
import { LoanStatements } from "@/documents/LoanStatements";
import { LoanShareCalculation } from "@/documents/LoanShareCalculation";
import { loadLoanShareCalculation } from "@/lib/finance/loan-share-calculation";

let db: Database;
let f: Fixture;
let loanId: string;
let g: Record<string, string>;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    g = {};
    for (const [label, shares] of [["A 1", 100], ["A 2", 100], ["A 3", 200]] as const) {
      g[label] = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, share_count) values ($1,$2,$3,$4) returning id", [f.orgA, f.companyA, label, shares])).id;
    }
    loanId = (await one<{ id: string }>(tx, "insert into er_loans (organization_id, company_id, name, principal_eur, balance_eur, balance_date, drawn_on) values ($1,$2,'Putkiremonttilaina',120000,100000,'2024-12-31','2020-06-01') returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_loans (organization_id, company_id, name, principal_eur, allocated) values ($1,$2,'Luottolimiitti',10000,false)", [f.orgA, f.companyA]);
  });
  await db.asUser(f.accountantA.sub, (tx) => recalculateLoanShares(tx, loanId, f.companyA, "2025-01-01"));
  // A 2 maksoi osuutensa kertasuorituksena 15.6.2025.
  await db.asUser(f.accountantA.sub, (tx) =>
    tx.query("update er_loan_shares set paid_off_on = '2025-06-15', paid_off_eur = 24500, remaining_eur = 0 where loan_id = $1 and share_group_id = $2", [loanId, g["A 2"]]),
  );
});
afterAll(async () => db.close());

describe("tilinpäätöksen laskelmat", () => {
  it("esitäyttää kertasuoritukset ja laskee osuudet tallennuksen jälkeen", async () => {
    const before = await db.asUser(f.accountantA.sub, (tx) => loadStatementData(tx, f.companyA, 2025));
    const loan = before!.loans.find((l) => l.id === loanId)!;
    expect(loan.saved).toBe(false);
    expect(loan.prefill).toEqual({ opening: null, lumpSum: "24500.00" });
    expect(before!.loans.find((l) => !l.allocated)?.name).toBe("Luottolimiitti");

    await db.asUser(f.accountantA.sub, async (tx) => {
      await saveLoanPeriod(tx, {
        companyId: f.companyA, loanId, endYear: 2025, note: null, userId: f.accountantA.id,
        values: { openingBalanceEur: "100000", drawnEur: "0", amortizationEur: "7500", lumpSumEur: "24500", closingBalanceEur: "68000", interestEur: "2100" },
      });
      await saveChargeStatement(tx, {
        companyId: f.companyA, endYear: 2025, note: null, userId: f.accountantA.id,
        values: { maintenanceIncomeEur: null, maintenanceExpensesEur: null, financingIncomeEur: "10000", interestFromFinancing: true, carriedInEur: "0" },
      });
    });
    const d = await db.asUser(f.accountantA.sub, (tx) => loadStatementData(tx, f.companyA, 2025));
    const s = d!.loans.find((l) => l.id === loanId)!.statement!;
    expect(s.warnings).toEqual([]);
    expect(s.rows.map((r) => [r.unitLabel, r.openingCents, r.lumpSumCents, r.closingCents])).toEqual([
      ["A 1", 2500000n, 0n, 2266666n],
      ["A 2", 2500000n, 2450000n, 0n],
      ["A 3", 5000000n, 0n, 4533334n],
    ]);
    expect(d!.result.financing).toMatchObject({ resultCents: 40000n, carriedOutCents: 40000n });

    // PDF syntyy ja sisältää laskelmat.
    const pdf = await renderDocumentPdf(<LoanStatements data={buildLoanStatementsData(d!, "Isännöinti Oy", "2026-02-15")} />);
    expect(pdf.sizeBytes).toBeGreaterThan(2000);
  });

  it("seuraava tilikausi alkaa edellisen loppusaldosta ja siirtää käyttämättömät rahoitusvastikkeet", async () => {
    const next = await db.asUser(f.accountantA.sub, (tx) => loadStatementData(tx, f.companyA, 2026));
    expect(next!.loans.find((l) => l.id === loanId)!.values.openingBalanceEur).toBe("68000.00");
    expect(next!.chargePrefill.carriedIn).toBe("400.00");
    expect(next!.charges.carriedInEur).toBe("400.00");
  });

  it("vie loppusaldon lainalle ja laskee osuudet uudelleen, kertasuorittaja pysyy nollassa", async () => {
    const n = await db.asUser(f.accountantA.sub, (tx) => applyClosingBalances(tx, { companyId: f.companyA, endYear: 2025, today: "2026-02-15" }));
    expect(n).toBe(1);
    const rows = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ unit_label: string; remaining_eur: string }>(
        "select g.unit_label, s.remaining_eur::text from er_loan_shares s join er_share_groups g on g.id = s.share_group_id where s.loan_id = $1 order by g.unit_label",
        [loanId],
      ),
    );
    expect(rows).toEqual([
      { unit_label: "A 1", remaining_eur: "22666.66" },
      { unit_label: "A 2", remaining_eur: "0.00" },
      { unit_label: "A 3", remaining_eur: "45333.34" },
    ]);
    // Toinen organisaatio ei näe laskelmia.
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_loan_periods"))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => loadStatementData(tx, f.companyA, 2025))).toBeNull();
  });

  it("osakkaan lainaosuuslaskelma: osuus, arvio maksupäivälle, maksuohje ja kertasuorittaja", async () => {
    await db.asService(async (tx) => {
      await tx.query("update er_loans set due_on = '2035-12-31' where id = $1", [loanId]);
      await tx.query("insert into er_company_billing_settings (organization_id, company_id, company_number, bank_iban) values ($1,$2,77,'FI2112345600000785')", [f.orgA, f.companyA]);
      await tx.query("insert into er_billing_unit_numbers (organization_id, company_id, share_group_id, seq_no) values ($1,$2,$3,1)", [f.orgA, f.companyA, g["A 1"]]);
      const p1 = await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, first_names, street_address, postal_code, city) values ($1,'Kakkonen','Osakas','Koulutuskatu 1 A 2','00100','Helsinki') returning id", [f.orgA]);
      const p2 = await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, first_names) values ($1,'Kakkonen','Puoliso') returning id", [f.orgA]);
      await tx.query(
        "insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, source) values ($1,$2,$3,2,3,'manual'),($1,$2,$4,1,3,'manual')",
        [f.orgA, g["A 1"], p1.id, p2.id],
      );
    });
    const calc = await db.asUser(f.accountantA.sub, (tx) =>
      loadLoanShareCalculation(tx, f.companyA, g["A 1"], { issuedOn: "2026-02-15", payOn: "2026-03-15", feeEur: "50", feeLabel: "Pankin perimä lisäkulu" }),
    );
    expect(calc!.recipient!.lines).toEqual(["Koulutuskatu 1 A 2", "00100 Helsinki"]);
    expect(calc!.recipient!.name).toContain(" ja ");
    expect(calc!.feeLabel).toBe("Pankin perimä lisäkulu");
    expect(calc!.loans[0].perShare).toBe("100 osaketta × 222,920000 €/osake");
    expect(calc!.loans).toHaveLength(1);
    expect(calc!.loans[0]).toMatchObject({ original: "30 000,00 €", remaining: "22 666,66 €", balanceDate: "2025-12-31", estimated: true });
    expect(calc!.fee).toBe("50,00 €");
    expect(calc!.payment).toMatchObject({ iban: "FI21 1234 5600 0007 85" });
    expect(calc!.payment!.reference!.replace(/\s/g, "")).toMatch(/^77/);
    const paid = await db.asUser(f.accountantA.sub, (tx) => loadLoanShareCalculation(tx, f.companyA, g["A 2"], { issuedOn: "2026-02-15", payOn: "2026-03-15", feeEur: null }));
    expect(paid!.loans[0].paidOff).toBe("Maksettu 15.6.2025, 24 500,00 €");
    expect(paid!.total).toBe("0,00 €");
    const pdf = await renderDocumentPdf(<LoanShareCalculation data={calc!} />);
    expect(pdf.sizeBytes).toBeGreaterThan(2000);
  });

  it("laina voi koskea vain osaa huoneistotyypeistä; muiden osuudet poistuvat uudelleenlaskennassa", async () => {
    const ids = await db.asService(async (tx) => {
      const garage = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, share_count, kind) values ($1,$2,'AT 1',4,'garage') returning id", [f.orgA, f.companyA])).id;
      const loan = (await one<{ id: string }>(tx, "insert into er_loans (organization_id, company_id, name, principal_eur) values ($1,$2,'Kattolaina',4000) returning id", [f.orgA, f.companyA])).id;
      return { garage, loan };
    });
    await db.asUser(f.accountantA.sub, (tx) => recalculateLoanShares(tx, ids.loan, f.companyA, "2026-01-01"));
    const count = async () => (await db.asUser(f.accountantA.sub, (tx) => tx.query<{ share_group_id: string }>("select share_group_id from er_loan_shares where loan_id = $1", [ids.loan]))).map((r) => r.share_group_id);
    expect(await count()).toContain(ids.garage);
    await db.asService((tx) => tx.query("update er_loans set applies_to_kinds = '{apartment}' where id = $1", [ids.loan]));
    await db.asUser(f.accountantA.sub, (tx) => recalculateLoanShares(tx, ids.loan, f.companyA, "2026-01-01"));
    const after = await count();
    expect(after).not.toContain(ids.garage);
    expect(after).toHaveLength(3);
    const sum = await db.asUser(f.accountantA.sub, (tx) => one<{ s: string }>(tx, "select sum(original_eur)::text as s from er_loan_shares where loan_id = $1", [ids.loan]));
    expect(sum.s).toBe("4000.00");
  });
});
