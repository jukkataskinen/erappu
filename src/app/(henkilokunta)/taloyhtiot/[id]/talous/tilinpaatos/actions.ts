"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { FinanceError } from "@/lib/finance/billing";
import { applyClosingBalances, saveChargeStatement, saveLoanPeriod } from "@/lib/finance/statement-data";
import { generateStatementDocument } from "@/lib/finance/statement-document";

const uuid = z.string().uuid();
const money = (label: string) =>
  z
    .string()
    .transform((v) => v.replace(/[\s ]/g, "").replace(",", "."))
    .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), `${label}: anna euromäärä, enintään kaksi desimaalia.`);
const optMoney = (label: string) => z.preprocess(emptyToNull, money(label).nullable());
const nonNegative = (label: string) => money(label).refine((v) => !v.startsWith("-"), `${label} ei voi olla negatiivinen.`);
const year = z.coerce.number().int().min(2000).max(2100);

function back(companyId: string, endYear: number, anchor = "") {
  return `/taloyhtiot/${companyId}/talous/tilinpaatos?vuosi=${endYear}${anchor}`;
}

async function writer(companyId: string, endYear: number) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant", "accountant")) fail(back(companyId, endYear), "Roolillasi ei voi muokata talouden tietoja.");
  return ctx;
}

function ids(formData: FormData): { companyId: string; endYear: number } {
  const companyId = String(formData.get("company_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) redirect("/taloyhtiot");
  const y = year.safeParse(formData.get("vuosi"));
  if (!y.success) redirect(`/taloyhtiot/${companyId}/talous`);
  return { companyId, endYear: y.data };
}

async function attempt<T>(to: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FinanceError) fail(to, err.message);
    throw err;
  }
}

const loanSchema = z.object({
  loan_id: uuid,
  opening_balance_eur: nonNegative("Alkusaldo"),
  drawn_eur: nonNegative("Nostot"),
  amortization_eur: nonNegative("Lyhennykset"),
  lump_sum_eur: nonNegative("Kertasuoritukset"),
  closing_balance_eur: nonNegative("Loppusaldo"),
  interest_eur: nonNegative("Korot"),
  note: z.preprocess(emptyToNull, z.string().max(500).nullable()),
});

export async function saveLoanPeriodAction(formData: FormData) {
  const { companyId, endYear } = ids(formData);
  const to = back(companyId, endYear, `#laina-${String(formData.get("loan_id") ?? "")}`);
  const ctx = await writer(companyId, endYear);
  const d = parseForm(loanSchema, formData, back(companyId, endYear));
  await attempt(to, () =>
    ctx.run(async (tx) => {
      await saveLoanPeriod(tx, {
        companyId,
        loanId: d.loan_id,
        endYear,
        values: {
          openingBalanceEur: d.opening_balance_eur, drawnEur: d.drawn_eur, amortizationEur: d.amortization_eur, lumpSumEur: d.lump_sum_eur,
          closingBalanceEur: d.closing_balance_eur, interestEur: d.interest_eur,
        },
        note: d.note,
        userId: ctx.user.id,
      });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "loan_period", entityId: d.loan_id, details: { year: endYear } });
    }),
  );
  revalidatePath(`/taloyhtiot/${companyId}/talous/tilinpaatos`);
  redirect(to);
}

const chargeSchema = z.object({
  maintenance_income_eur: optMoney("Hoitotuotot"),
  maintenance_expenses_eur: optMoney("Hoitokulut"),
  financing_income_eur: optMoney("Rahoitusvastikkeet"),
  interest_from_financing: z.preprocess((v) => v === "on", z.boolean()),
  carried_in_eur: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? "0" : v), money("Siirtyneet rahoitusvastikkeet")),
  note: z.preprocess(emptyToNull, z.string().max(1000).nullable()),
});

export async function saveChargeStatementAction(formData: FormData) {
  const { companyId, endYear } = ids(formData);
  const to = back(companyId, endYear, "#jalkilaskelma");
  const ctx = await writer(companyId, endYear);
  const d = parseForm(chargeSchema, formData, back(companyId, endYear));
  if ((d.maintenance_income_eur === null) !== (d.maintenance_expenses_eur === null)) fail(to, "Anna sekä hoitotuotot että hoitokulut, tai jätä molemmat tyhjiksi.");
  await attempt(to, () =>
    ctx.run(async (tx) => {
      await saveChargeStatement(tx, {
        companyId,
        endYear,
        values: {
          maintenanceIncomeEur: d.maintenance_income_eur, maintenanceExpensesEur: d.maintenance_expenses_eur, financingIncomeEur: d.financing_income_eur,
          interestFromFinancing: d.interest_from_financing, carriedInEur: d.carried_in_eur,
        },
        note: d.note,
        userId: ctx.user.id,
      });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "charge_statement", entityId: companyId, details: { year: endYear } });
    }),
  );
  revalidatePath(`/taloyhtiot/${companyId}/talous/tilinpaatos`);
  redirect(to);
}

export async function applyClosingBalancesAction(formData: FormData) {
  const { companyId, endYear } = ids(formData);
  const to = back(companyId, endYear);
  const ctx = await writer(companyId, endYear);
  const count = await attempt(to, () =>
    ctx.run(async (tx) => {
      const n = await applyClosingBalances(tx, { companyId, endYear, today: isoDateHelsinki() });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "loan_balances", entityId: companyId, details: { year: endYear, loans: n } });
      return n;
    }),
  );
  revalidatePath(`/taloyhtiot/${companyId}/talous`);
  redirect(`${to}&saldot=${count}`);
}

export async function generateStatementPdfAction(formData: FormData) {
  const { companyId, endYear } = ids(formData);
  const to = back(companyId, endYear);
  const ctx = await writer(companyId, endYear);
  const documentId = await attempt(to, () =>
    generateStatementDocument((fn) => ctx.run(fn), { companyId, endYear, userId: ctx.user.id, issuedOn: isoDateHelsinki() }),
  );
  await ctx.run((tx) =>
    audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "generate_document", entity: "charge_statement", entityId: companyId, details: { year: endYear, documentId } }),
  );
  revalidatePath(`/taloyhtiot/${companyId}/dokumentit`);
  redirect(`${to}&asiakirja=${documentId}`);
}
