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
});
