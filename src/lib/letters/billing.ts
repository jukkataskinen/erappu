import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isFennoaError, type FennoaClient } from "@/lib/fennoa";
import { LetterError, type Runner } from "./jobs";
import { billingProblems, buildFennoaForm, chargeFor, invoiceRows, letterPricesFrom, type BillableJob, type BillingProfile, type InvoiceRow } from "./pricing";

/**
 * Postikulujen laskutus taloyhtiöiltä (Jukka 26.9.2026): laskurit yhtiöittäin
 * ja laskutusajo, joka tekee jakson postituksista yhden laskun yhtiötä kohden
 * ja vie sen Fennoaan luonnoksena. Laskutettava postitus on vahvistettu
 * kirjetyö (CO, PR, SE); vahvistuspäivä ratkaisee jakson. Kirjetyö sidotaan
 * laskuun, jolloin sitä ei voi laskuttaa kahdesti eikä perua.
 */

/** Vahvistettu kirjetyö; palveluntarjoajat parametrina $4. */
const BILLABLE = "j.status in ('CO', 'PR', 'SE') and j.provider = any($4::text[])";
/** Testitilan postitukset näkyvät kehityksessä, mutta tuotannossa laskutetaan vain oikeat postitukset. */
function billableProviders(): string[] {
  return process.env.NODE_ENV === "production" ? ["postita"] : ["postita", "mock"];
}

export interface CompanyCounter {
  company_id: string;
  company_name: string;
  mailings: number;
  letters: number;
  pages: number;
  /** Postitan hinta tai arvio, alv 0. */
  cost_eur: number;
  /** Veloitus taloyhtiöltä, alv 0 (lukittu hinta tai nykyinen hinta, jos lukitsematta). */
  charge_eur: number;
  billed_eur: number;
  unbilled_eur: number;
  /** Postitukset ilman lukittua hintaa (vahvistettu ennen kuin hinnat asetettiin). */
  unpriced: number;
  has_profile_problems: boolean;
}

const POSTITA_ESTIMATE = "(j.letter_count * (case j.post_class when 1 then 3.27 else 2.34 end) + j.letter_count * greatest(j.pages_per_letter - 1, 0) * 0.16)";

/** Laskurit jaksolle (vahvistuspäivä Helsingin aikaa) yhtiöittäin. */
export async function letterCounters(tx: Sql, organizationId: string, period: { start: string; end: string }): Promise<CompanyCounter[]> {
  const [org] = await tx.query<{ settings: { letter_prices?: Record<string, unknown> } | null }>("select settings from er_organizations where id = $1", [organizationId]);
  const prices = letterPricesFrom(org?.settings);
  const rows = await tx.query<{
    company_id: string; company_name: string; mailings: number; letters: number; pages: number; cost_eur: string;
    locked_eur: string; billed_eur: string; unpriced: number; post_class_1_letters: number; post_class_2_letters: number; unpriced_extra_pages: number;
  }>(
    `select c.id as company_id, c.name as company_name, count(*)::int as mailings, sum(j.letter_count)::int as letters,
            sum(j.letter_count * j.pages_per_letter)::int as pages,
            sum(coalesce(j.price, ${POSTITA_ESTIMATE}))::text as cost_eur,
            coalesce(sum(j.charge_total_eur), 0)::text as locked_eur,
            coalesce(sum(j.charge_total_eur) filter (where j.billing_invoice_id is not null), 0)::text as billed_eur,
            count(*) filter (where j.charge_total_eur is null)::int as unpriced,
            coalesce(sum(j.letter_count) filter (where j.charge_total_eur is null and j.post_class = 1), 0)::int as post_class_1_letters,
            coalesce(sum(j.letter_count) filter (where j.charge_total_eur is null and j.post_class = 2), 0)::int as post_class_2_letters,
            coalesce(sum(j.letter_count * greatest(j.pages_per_letter - 1, 0)) filter (where j.charge_total_eur is null), 0)::int as unpriced_extra_pages
       from er_letter_jobs j join er_housing_companies c on c.id = j.company_id
      where j.organization_id = $1 and ${BILLABLE}
        and (coalesce(j.confirmed_at, j.created_at) at time zone 'Europe/Helsinki')::date between $2::date and $3::date
      group by c.id, c.name
      order by c.name`,
    [organizationId, period.start, period.end, billableProviders()],
  );
  const profiles = await tx.query<BillingProfile & { company_id: string }>(
    `select c.id as company_id, c.name as company_name, c.business_id, b.fennoa_customer_no, b.invoice_channel, b.einvoice_address, b.einvoice_operator,
            b.email, b.street_address, b.postal_code, b.city
       from er_housing_companies c left join er_company_billing b on b.company_id = c.id where c.organization_id = $1`,
    [organizationId],
  );
  const profileById = new Map(profiles.map((p) => [p.company_id, p]));
  return rows.map((r) => {
    const unlocked = prices
      ? r.post_class_1_letters * prices.class1_eur + r.post_class_2_letters * prices.class2_eur + r.unpriced_extra_pages * prices.extra_page_eur
      : 0;
    const charge = Math.round((Number(r.locked_eur) + unlocked) * 100) / 100;
    const billed = Number(r.billed_eur);
    const profile = profileById.get(r.company_id);
    return {
      company_id: r.company_id,
      company_name: r.company_name,
      mailings: r.mailings,
      letters: r.letters,
      pages: r.pages,
      cost_eur: Math.round(Number(r.cost_eur) * 100) / 100,
      charge_eur: charge,
      billed_eur: billed,
      unbilled_eur: Math.round((charge - billed) * 100) / 100,
      unpriced: r.unpriced,
      has_profile_problems: billingProblems(profile ?? null).length > 0,
    };
  });
}

export async function getBillingProfile(tx: Sql, companyId: string): Promise<(BillingProfile & { company_id: string; saved: boolean }) | null> {
  const [row] = await tx.query<BillingProfile & { company_id: string; saved: boolean; company_street: string | null; company_postal: string | null; company_city: string | null }>(
    `select c.id as company_id, c.name as company_name, c.business_id, b.id is not null as saved, b.fennoa_customer_no, b.invoice_channel,
            b.einvoice_address, b.einvoice_operator, b.email, b.street_address, b.postal_code, b.city,
            c.street_address as company_street, c.postal_code as company_postal, c.city as company_city
       from er_housing_companies c left join er_company_billing b on b.company_id = c.id where c.id = $1`,
    [companyId],
  );
  if (!row) return null;
  // Tallentamattomalle esitäytetään yhtiön osoite; kanavaa ei esitäytetä.
  const { company_street, company_postal, company_city, ...profile } = row;
  return row.saved ? profile : { ...profile, street_address: company_street, postal_code: company_postal, city: company_city };
}

export async function saveBillingProfile(
  tx: Sql,
  input: { organizationId: string; companyId: string; userId: string } & Omit<BillingProfile, "company_name" | "business_id">,
): Promise<void> {
  await tx.query(
    `insert into er_company_billing (organization_id, company_id, fennoa_customer_no, invoice_channel, einvoice_address, einvoice_operator, email, street_address, postal_code, city, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (company_id) do update set fennoa_customer_no = excluded.fennoa_customer_no, invoice_channel = excluded.invoice_channel,
       einvoice_address = excluded.einvoice_address, einvoice_operator = excluded.einvoice_operator, email = excluded.email,
       street_address = excluded.street_address, postal_code = excluded.postal_code, city = excluded.city, updated_by = excluded.updated_by, updated_at = now()`,
    [input.organizationId, input.companyId, input.fennoa_customer_no, input.invoice_channel, input.einvoice_address, input.einvoice_operator, input.email,
      input.street_address, input.postal_code, input.city, input.userId],
  );
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "update_billing_profile", entity: "housing_company", entityId: input.companyId });
}

export interface RunInvoice {
  id: string;
  company_id: string;
  company_name: string;
  total_net_eur: string;
  status: "pending" | "exporting" | "exported" | "failed";
  environment: string | null;
  fennoa_invoice_id: string | null;
  message: string | null;
  profile: BillingProfile;
  problems: string[];
  rows: InvoiceRow[];
}

export interface BillingRun {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  invoice_date: string;
  due_date: string;
  vat_percent: string;
  created_at: string;
  created_by_name: string | null;
}

export async function listBillingRuns(tx: Sql, organizationId: string) {
  return tx.query<BillingRun & { invoices: number; exported: number; total_net_eur: string }>(
    `select r.id, r.organization_id, r.period_start::text, r.period_end::text, r.invoice_date::text, r.due_date::text, r.vat_percent::text, r.created_at,
            coalesce(u.full_name, u.email) as created_by_name,
            (select count(*)::int from er_letter_billing_invoices i where i.run_id = r.id) as invoices,
            (select count(*)::int from er_letter_billing_invoices i where i.run_id = r.id and i.status = 'exported') as exported,
            (select coalesce(sum(i.total_net_eur), 0)::text from er_letter_billing_invoices i where i.run_id = r.id) as total_net_eur
       from er_letter_billing_runs r left join er_users u on u.id = r.created_by
      where r.organization_id = $1 order by r.created_at desc limit 50`,
    [organizationId],
  );
}

async function jobsForInvoice(tx: Sql, invoiceId: string): Promise<BillableJob[]> {
  return tx.query<BillableJob>(
    `select j.description, ((coalesce(j.confirmed_at, j.created_at)) at time zone 'Europe/Helsinki')::date::text as confirmed_on, j.post_class,
            j.letter_count, j.pages_per_letter, j.charge_letter_eur::float8 as charge_letter_eur, j.charge_page_eur::float8 as charge_page_eur
       from er_letter_jobs j where j.billing_invoice_id = $1`,
    [invoiceId],
  );
}

export async function getBillingRun(tx: Sql, runId: string): Promise<{ run: BillingRun; invoices: RunInvoice[] } | null> {
  const [run] = await tx.query<BillingRun>(
    `select r.id, r.organization_id, r.period_start::text, r.period_end::text, r.invoice_date::text, r.due_date::text, r.vat_percent::text, r.created_at,
            coalesce(u.full_name, u.email) as created_by_name
       from er_letter_billing_runs r left join er_users u on u.id = r.created_by where r.id = $1`,
    [runId],
  );
  if (!run) return null;
  const rows = await tx.query<Omit<RunInvoice, "profile" | "problems" | "rows"> & Omit<BillingProfile, "company_name">>(
    `select i.id, i.company_id, c.name as company_name, i.total_net_eur::text, i.status, i.environment, i.fennoa_invoice_id, i.message,
            c.business_id, b.fennoa_customer_no, b.invoice_channel, b.einvoice_address, b.einvoice_operator, b.email, b.street_address, b.postal_code, b.city
       from er_letter_billing_invoices i join er_housing_companies c on c.id = i.company_id left join er_company_billing b on b.company_id = i.company_id
      where i.run_id = $1 order by c.name`,
    [runId],
  );
  const invoices: RunInvoice[] = [];
  for (const r of rows) {
    const profile: BillingProfile = {
      company_name: r.company_name, business_id: r.business_id, fennoa_customer_no: r.fennoa_customer_no, invoice_channel: r.invoice_channel,
      einvoice_address: r.einvoice_address, einvoice_operator: r.einvoice_operator, email: r.email, street_address: r.street_address, postal_code: r.postal_code, city: r.city,
    };
    invoices.push({
      id: r.id, company_id: r.company_id, company_name: r.company_name, total_net_eur: r.total_net_eur, status: r.status, environment: r.environment,
      fennoa_invoice_id: r.fennoa_invoice_id, message: r.message, profile, problems: billingProblems(profile), rows: invoiceRows(await jobsForInvoice(tx, r.id)),
    });
  }
  return { run, invoices };
}

/**
 * Laskutusajo jaksolle: laskuttamattomat vahvistetut postitukset yhtiöittäin.
 * Hinnaton postitus (vahvistettu ennen hintojen asettamista) saa nykyisen
 * hinnan nyt. Kaikki yhdessä transaktiossa: postitus sidotaan laskuun samalla,
 * joten rinnakkainen ajo ei saa samaa postitusta.
 */
export async function createBillingRun(
  run: Runner,
  input: { organizationId: string; userId: string; periodStart: string; periodEnd: string; invoiceDate: string; dueDate: string },
): Promise<string> {
  return run(async (tx) => {
    const [org] = await tx.query<{ settings: { letter_prices?: Record<string, unknown> } | null }>("select settings from er_organizations where id = $1", [input.organizationId]);
    const prices = letterPricesFrom(org?.settings);
    if (!prices) throw new LetterError("Aseta kirjeiden hinnat taloyhtiöille asetuksiin ennen laskutusta.");
    const jobs = await tx.query<{ id: string; company_id: string; post_class: 1 | 2; letter_count: number; pages_per_letter: number; charge_total_eur: string | null }>(
      `select j.id, j.company_id, j.post_class, j.letter_count, j.pages_per_letter, j.charge_total_eur::text as charge_total_eur
         from er_letter_jobs j
        where j.organization_id = $1 and ${BILLABLE} and j.billing_invoice_id is null
          and (coalesce(j.confirmed_at, j.created_at) at time zone 'Europe/Helsinki')::date between $2::date and $3::date
        for update of j`,
      [input.organizationId, input.periodStart, input.periodEnd, billableProviders()],
    );
    if (jobs.length === 0) throw new LetterError("Jaksolla ei ole laskuttamattomia postituksia.");
    const [created] = await tx.query<{ id: string }>(
      `insert into er_letter_billing_runs (organization_id, period_start, period_end, invoice_date, due_date, vat_percent, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [input.organizationId, input.periodStart, input.periodEnd, input.invoiceDate, input.dueDate, prices.vat_percent, input.userId],
    );
    const byCompany = new Map<string, typeof jobs>();
    for (const j of jobs) byCompany.set(j.company_id, [...(byCompany.get(j.company_id) ?? []), j]);
    for (const [companyId, list] of byCompany) {
      let total = 0;
      for (const j of list) {
        if (j.charge_total_eur === null) {
          const c = chargeFor(prices, j.post_class, j.letter_count, j.pages_per_letter);
          j.charge_total_eur = String(c.totalEur);
          await tx.query("update er_letter_jobs set charge_letter_eur = $2, charge_page_eur = $3, charge_total_eur = $4 where id = $1", [j.id, c.letterEur, c.pageEur, c.totalEur]);
        }
        total += Number(j.charge_total_eur);
      }
      const [inv] = await tx.query<{ id: string }>(
        "insert into er_letter_billing_invoices (organization_id, run_id, company_id, total_net_eur) values ($1,$2,$3,$4) returning id",
        [input.organizationId, created.id, companyId, Math.round(total * 100) / 100],
      );
      await tx.query("update er_letter_jobs set billing_invoice_id = $2 where id = any($1::uuid[])", [list.map((j) => j.id), inv.id]);
    }
    await audit(tx, {
      organizationId: input.organizationId, userId: input.userId, action: "create_letter_billing_run", entity: "letter_billing_run", entityId: created.id,
      details: { periodStart: input.periodStart, periodEnd: input.periodEnd, companies: byCompany.size, mailings: jobs.length },
    });
    return created.id;
  });
}

/** Poistaa ajon, jos yhtään laskua ei ole viety Fennoaan. Postitukset palaavat laskuttamattomiksi. */
export async function deleteBillingRun(run: Runner, input: { userId: string; runId: string }): Promise<void> {
  await run(async (tx) => {
    const [r] = await tx.query<{ organization_id: string }>("select organization_id from er_letter_billing_runs where id = $1 for update", [input.runId]);
    if (!r) throw new LetterError("Laskutusajoa ei löytynyt.");
    const [done] = await tx.query<{ n: number }>("select count(*)::int as n from er_letter_billing_invoices where run_id = $1 and status in ('exported', 'exporting')", [input.runId]);
    if (done.n > 0) throw new LetterError("Ajosta on jo viety laskuja Fennoaan, joten sitä ei voi poistaa.");
    await tx.query("update er_letter_jobs set billing_invoice_id = null where billing_invoice_id in (select id from er_letter_billing_invoices where run_id = $1)", [input.runId]);
    await tx.query("delete from er_letter_billing_runs where id = $1", [input.runId]);
    await audit(tx, { organizationId: r.organization_id, userId: input.userId, action: "delete_letter_billing_run", entity: "letter_billing_run", entityId: input.runId });
  });
}

/**
 * Vie ajon viemättömät ja epäonnistuneet laskut Fennoaan luonnoksiksi. Lasku
 * varataan (exporting) ennen Fennoa-kutsua, joten sama lasku ei lähde
 * kahdesti. Puutteellinen lasku jätetään viemättä ja puute kirjataan.
 */
export async function exportBillingRun(run: Runner, client: FennoaClient, input: { userId: string; runId: string }): Promise<{ exported: number; failed: number; skipped: number }> {
  const loaded = await run((tx) => getBillingRun(tx, input.runId));
  if (!loaded) throw new LetterError("Laskutusajoa ei löytynyt.");
  const { run: r, invoices } = loaded;
  let exported = 0;
  let failed = 0;
  let skipped = 0;
  for (const inv of invoices.filter((i) => i.status === "pending" || i.status === "failed")) {
    if (inv.problems.length) {
      skipped++;
      await run((tx) => tx.query("update er_letter_billing_invoices set status = 'failed', message = $2 where id = $1", [inv.id, inv.problems.join(" ")]));
      continue;
    }
    const claimed = await run((tx) =>
      tx.query("update er_letter_billing_invoices set status = 'exporting', environment = $2, message = null where id = $1 and status in ('pending', 'failed') returning id", [inv.id, client.environment]),
    );
    if (!claimed.length) continue;
    const form = buildFennoaForm({ profile: inv.profile, rows: inv.rows, vatPercent: Number(r.vat_percent), invoiceDate: r.invoice_date, dueDate: r.due_date, periodStart: r.period_start, periodEnd: r.period_end });
    try {
      const { id } = await client.addInvoice(form);
      await run((tx) => tx.query("update er_letter_billing_invoices set status = 'exported', fennoa_invoice_id = $2, exported_at = now() where id = $1", [inv.id, id]));
      exported++;
    } catch (err) {
      const message = isFennoaError(err) ? err.message : "Vienti epäonnistui.";
      await run((tx) => tx.query("update er_letter_billing_invoices set status = 'failed', message = $2 where id = $1", [inv.id, message]));
      failed++;
      if (!isFennoaError(err)) throw err;
    }
  }
  await run((tx) =>
    audit(tx, { organizationId: r.organization_id, userId: input.userId, action: "export_letter_billing_run", entity: "letter_billing_run", entityId: r.id, details: { exported, failed, skipped, environment: client.environment } }),
  );
  return { exported, failed, skipped };
}

/**
 * Kesken jäänyt vienti (palvelin kaatui Fennoa-kutsun aikana) ei lähde
 * uudelleen itsestään, koska lasku voi jo olla Fennoassa. Kun käyttäjä on
 * tarkistanut, ettei laskua ole Fennoassa, sen voi palauttaa vietäväksi.
 */
export async function releaseStuckInvoice(run: Runner, input: { userId: string; invoiceId: string }): Promise<void> {
  await run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_letter_billing_invoices set status = 'failed', message = 'Vienti keskeytyi; tarkistettu, ettei laskua ole Fennoassa.' where id = $1 and status = 'exporting' returning organization_id",
      [input.invoiceId],
    );
    if (!rows.length) throw new LetterError("Laskun vienti ei ole kesken.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: input.userId, action: "release_letter_billing_invoice", entity: "letter_billing_invoice", entityId: input.invoiceId });
  });
}

/** Erittely CSV:nä (puolipiste, UTF-8 BOM) laskujen tekemiseen Fennoaan käsin. */
export function billingRunCsv(data: { run: BillingRun; invoices: RunInvoice[] }): string {
  const q = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Taloyhtiö", "Y-tunnus", "Fennoan asiakasnumero", "Laskukanava", "Rivi", "Määrä", "Yksikkö", "Hinta alv 0", "Yhteensä alv 0", "Alv %"].join(";")];
  for (const inv of data.invoices) {
    for (const row of inv.rows) {
      lines.push(
        [inv.company_name, inv.profile.business_id ?? "", inv.profile.fennoa_customer_no ?? "", inv.profile.invoice_channel ?? "", row.name, row.quantity, row.unit, row.price, row.total, Number(data.run.vat_percent)]
          .map(q)
          .join(";"),
      );
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
