import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import {
  billingRunCsv,
  createBillingRun,
  deleteBillingRun,
  exportBillingRun,
  getBillingRun,
  letterCounters,
  releaseStuckInvoice,
  saveBillingProfile,
} from "@/lib/letters/billing";
import { FennoaError, type FennoaClient } from "@/lib/fennoa";

/**
 * Postikulujen laskutus taloyhtiöiltä: laskurit, laskutusajo ilman
 * kaksoislaskutusta, vienti Fennoaan luonnoksina ja organisaatioeristys.
 */
let db: Database;
let f: Fixture;
let secondCompany: string;
const runAs = (sub: string) => <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(sub, fn);

async function job(tx: Sql, companyId: string, o: { confirmedAt: string; letters: number; pages: number; postClass?: 1 | 2; status?: string; charge?: [number, number, number] | null; org?: string; description?: string }) {
  return (
    await one<{ id: string }>(
      tx,
      `insert into er_letter_jobs (organization_id, company_id, subject_table, subject_id, provider, provider_job_id, status, post_class, letter_count, pages_per_letter,
                                   confirmed_at, description, charge_letter_eur, charge_page_eur, charge_total_eur)
       values ($1,$2,'er_meetings',gen_random_uuid(),'mock','mock-1',$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [o.org ?? f.orgA, companyId, o.status ?? "CO", o.postClass ?? 2, o.letters, o.pages, o.confirmedAt, o.description ?? "Kokouskutsu: yhtiökokous",
        o.charge?.[0] ?? null, o.charge?.[1] ?? null, o.charge?.[2] ?? null],
    )
  ).id;
}

const profile = {
  fennoa_customer_no: "1042", invoice_channel: "einvoice", einvoice_address: "003712345671", einvoice_operator: "003723327487", email: null,
  street_address: "Testitie 1", postal_code: "41660", city: "Toivakka",
};

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    await tx.query(`update er_organizations set settings = settings || '{"letter_prices": {"class1_eur": 3.9, "class2_eur": 2.9, "extra_page_eur": 0.2}}'::jsonb where id = $1`, [f.orgA]);
    secondCompany = (await one<{ id: string }>(tx, "insert into er_housing_companies (organization_id, name, business_id) values ($1, 'As Oy Toinen A', '1111111-1') returning id", [f.orgA])).id;
    // Lukittu hinta (vahvistettu, kun hinnat olivat 2,50 €): hinnanmuutos ei muuta sitä.
    await job(tx, f.companyA, { confirmedAt: "2026-07-10T09:00:00Z", letters: 4, pages: 3, charge: [2.5, 0.2, 11.6], description: "Kokouskutsu: varsinainen yhtiökokous 12.8.2026" });
    // Hinnaton (vahvistettu ennen hintojen asettamista): saa nykyisen hinnan ajossa.
    await job(tx, f.companyA, { confirmedAt: "2026-09-02T09:00:00Z", letters: 3, pages: 1, charge: null, description: "Tiedote: Vesikatko" });
    await job(tx, secondCompany, { confirmedAt: "2026-08-01T09:00:00Z", letters: 2, pages: 1, postClass: 1, charge: [3.9, 0.2, 7.8] });
    // Jakson ulkopuolella, peruttu ja vahvistamaton eivät kuulu laskutukseen.
    await job(tx, f.companyA, { confirmedAt: "2026-10-02T09:00:00Z", letters: 9, pages: 1, charge: [2.9, 0.2, 26.1] });
    await job(tx, f.companyA, { confirmedAt: "2026-08-02T09:00:00Z", letters: 9, pages: 1, status: "CA", charge: [2.9, 0.2, 26.1] });
    await job(tx, f.companyA, { confirmedAt: "2026-08-03T09:00:00Z", letters: 9, pages: 1, status: "NE" });
    await job(tx, f.companyB, { confirmedAt: "2026-08-03T09:00:00Z", letters: 5, pages: 1, charge: [1, 0, 5], org: f.orgB });
  });
});
afterAll(async () => db.close());

const Q3 = { start: "2026-07-01", end: "2026-09-30" };

describe("laskurit", () => {
  it("jakson vahvistetut postitukset yhtiöittäin", async () => {
    const counters = await runAs(f.managerA.sub)((tx) => letterCounters(tx, f.orgA, Q3));
    const a = counters.find((c) => c.company_id === f.companyA)!;
    expect(a).toMatchObject({ mailings: 2, letters: 7, pages: 15, charge_eur: 20.3, billed_eur: 0, unbilled_eur: 20.3, unpriced: 1, has_profile_problems: true });
    // Postitan hinta: 4 × 2,34 + 8 × 0,16 ja 3 × 2,34.
    expect(a.cost_eur).toBe(17.66);
    expect(counters.map((c) => c.company_id)).not.toContain(f.companyB);
  });
});

describe("laskutusajo", () => {
  let runId: string;

  it("tekee laskun yhtiötä kohden eikä laskuta samaa postitusta kahdesti", async () => {
    const run = runAs(f.accountantA.sub);
    runId = await createBillingRun(run, { organizationId: f.orgA, userId: f.accountantA.id, periodStart: Q3.start, periodEnd: Q3.end, invoiceDate: "2026-10-01", dueDate: "2026-10-15" });
    const data = await run((tx) => getBillingRun(tx, runId));
    expect(data?.invoices.map((i) => [i.company_name, i.total_net_eur])).toEqual([
      ["As Oy Testi A", "20.30"],
      ["As Oy Toinen A", "7.80"],
    ]);
    expect(data?.invoices[0].rows.map((r) => r.name)).toEqual([
      "Kokouskutsu: varsinainen yhtiökokous 12.8.2026, postitettu 10.7.2026 (2. lk)",
      "Kokouskutsu: varsinainen yhtiökokous 12.8.2026: lisäsivut",
      "Tiedote: Vesikatko, postitettu 2.9.2026 (2. lk)",
    ]);
    await expect(createBillingRun(run, { organizationId: f.orgA, userId: f.accountantA.id, periodStart: Q3.start, periodEnd: Q3.end, invoiceDate: "2026-10-01", dueDate: "2026-10-15" })).rejects.toThrow(
      /ei ole laskuttamattomia/,
    );
    const counters = await run((tx) => letterCounters(tx, f.orgA, Q3));
    expect(counters.every((c) => c.unbilled_eur === 0)).toBe(true);
  });

  it("kirjanpitäjä ei voi muuttaa kirjetyön tilaa eikä lukittua hintaa", async () => {
    await expect(db.asUser(f.accountantA.sub, (tx) => tx.query("update er_letter_jobs set status = 'CA' where company_id = $1", [f.companyA]))).rejects.toThrow();
    await expect(db.asUser(f.accountantA.sub, (tx) => tx.query("update er_letter_jobs set charge_total_eur = 0 where company_id = $1", [f.companyA]))).rejects.toThrow();
  });

  it("puutteellisia laskutustietoja ei viedä; täydennetty lasku viedään luonnokseksi", async () => {
    const forms: Record<string, string>[] = [];
    const client: FennoaClient = { environment: "mock", addInvoice: async (form) => (forms.push(form), { id: `f-${forms.length}` }) };
    const run = runAs(f.managerA.sub);
    const first = await exportBillingRun(run, client, { userId: f.managerA.id, runId });
    expect(first).toEqual({ exported: 0, failed: 0, skipped: 2 });

    await run((tx) => saveBillingProfile(tx, { organizationId: f.orgA, companyId: f.companyA, userId: f.managerA.id, ...profile }));
    const second = await exportBillingRun(run, client, { userId: f.managerA.id, runId });
    expect(second).toEqual({ exported: 1, failed: 0, skipped: 1 });
    expect(forms[0]).toMatchObject({ customer_no: "1042", delivery_method: "finvoice", "row[3][name]": "Tiedote: Vesikatko, postitettu 2.9.2026 (2. lk)", "row[3][price]": "2.9" });

    // Viety lasku ei lähde uudelleen, ja ajoa ei voi enää poistaa.
    const third = await exportBillingRun(run, client, { userId: f.managerA.id, runId });
    expect(third.exported).toBe(0);
    expect(forms).toHaveLength(1);
    await expect(deleteBillingRun(run, { userId: f.managerA.id, runId })).rejects.toThrow(/jo viety/);

    const csv = billingRunCsv((await run((tx) => getBillingRun(tx, runId)))!);
    expect(csv.startsWith("﻿Taloyhtiö;")).toBe(true);
    expect(csv).toContain("As Oy Testi A;1234567-1;1042;einvoice;Tiedote: Vesikatko, postitettu 2.9.2026 (2. lk);3;kpl;2,9;8,7;25,5");
  });

  it("Fennoan virhe kirjataan laskulle ja lasku jää vietäväksi", async () => {
    const run = runAs(f.managerA.sub);
    await run((tx) => saveBillingProfile(tx, { organizationId: f.orgA, companyId: secondCompany, userId: f.managerA.id, ...profile, fennoa_customer_no: "1043" }));
    const failing: FennoaClient = { environment: "test", addInvoice: async () => { throw new FennoaError("Fennoa: customer_no not found", 422); } };
    expect(await exportBillingRun(run, failing, { userId: f.managerA.id, runId })).toEqual({ exported: 0, failed: 1, skipped: 0 });
    const inv = (await run((tx) => getBillingRun(tx, runId)))!.invoices.find((i) => i.company_id === secondCompany)!;
    expect(inv).toMatchObject({ status: "failed", message: "Fennoa: customer_no not found" });
  });

  it("keskeytynyt vienti palautetaan vain käsin", async () => {
    const run = runAs(f.managerA.sub);
    const inv = (await run((tx) => getBillingRun(tx, runId)))!.invoices.find((i) => i.company_id === secondCompany)!;
    await db.asService((tx) => tx.query("update er_letter_billing_invoices set status = 'exporting' where id = $1", [inv.id]));
    const client: FennoaClient = { environment: "mock", addInvoice: async () => ({ id: "x" }) };
    expect((await exportBillingRun(run, client, { userId: f.managerA.id, runId })).exported).toBe(0);
    await releaseStuckInvoice(run, { userId: f.managerA.id, invoiceId: inv.id });
    expect((await exportBillingRun(run, client, { userId: f.managerA.id, runId })).exported).toBe(1);
  });

  it("poistettu ajo palauttaa postitukset laskuttamattomiksi", async () => {
    const run = runAs(f.managerA.sub);
    await db.asService((tx) => job(tx, f.companyA, { confirmedAt: "2026-11-02T09:00:00Z", letters: 1, pages: 1, charge: [2.9, 0.2, 2.9] }));
    const q4 = { periodStart: "2026-11-01", periodEnd: "2026-11-30", invoiceDate: "2026-12-01", dueDate: "2026-12-15" };
    const id = await createBillingRun(run, { organizationId: f.orgA, userId: f.managerA.id, ...q4 });
    await deleteBillingRun(run, { userId: f.managerA.id, runId: id });
    const again = await createBillingRun(run, { organizationId: f.orgA, userId: f.managerA.id, ...q4 });
    expect(again).not.toBe(id);
  });
});

describe("postikulujen RLS", () => {
  it("toinen organisaatio ei näe laskutusta eikä voi luoda sitä toisen yhtiölle", async () => {
    for (const table of ["er_letter_billing_runs", "er_letter_billing_invoices", "er_company_billing"]) {
      expect(await db.asUser(f.managerB.sub, (tx) => tx.query(`select id from ${table}`))).toEqual([]);
    }
    const countersB = await db.asUser(f.managerB.sub, (tx) => letterCounters(tx, f.orgA, Q3));
    expect(countersB).toEqual([]);
    await expect(
      db.asUser(f.managerB.sub, (tx) => saveBillingProfile(tx, { organizationId: f.orgB, companyId: f.companyA, userId: f.managerB.id, ...profile })),
    ).rejects.toThrow();
    await expect(
      db.asUser(f.managerB.sub, (tx) => tx.query("insert into er_letter_billing_runs (organization_id, period_start, period_end, invoice_date, due_date, vat_percent) values ($1,'2026-01-01','2026-01-31','2026-02-01','2026-02-15',25.5)", [f.orgA])),
    ).rejects.toThrow();
  });
});
