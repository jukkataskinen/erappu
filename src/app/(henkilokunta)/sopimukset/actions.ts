"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db";
import { defaultReminderOn } from "@/lib/contracts/deadlines";
import { CONTRACT_CATEGORIES } from "@/lib/contracts/labels";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { isIsoDate } from "@/lib/tasks/dates";

const uuid = z.string().uuid();
const optDate = z.preprocess(emptyToNull, z.string().refine(isIsoDate, "Tarkista päivämäärä.").nullable());

const contractSchema = z
  .object({
    company_id: z.string().uuid("Valitse yhtiö."),
    counterparty: z.string().min(1, "Anna vastapuoli.").max(200),
    category: z.enum(CONTRACT_CATEGORIES),
    description: z.preprocess(emptyToNull, z.string().max(4000).nullable()),
    starts_on: optDate,
    ends_on: optDate,
    notice_months: z.preprocess(emptyToNull, z.coerce.number().int("Irtisanomisaika kokonaisina kuukausina.").min(0).max(60).nullable()),
    annual_cost_eur: z.preprocess(
      (v) => (typeof v === "string" ? emptyToNull(v.replace(/[\s €]/g, "").replace(",", ".")) : v),
      z.coerce.number().min(0, "Vuosikustannus ei voi olla negatiivinen.").max(100_000_000).nullable(),
    ),
    document_id: z.preprocess(emptyToNull, uuid.nullable()),
    reminder_on: optDate,
    status: z.enum(["active", "ending", "ended"]).default("active"),
  })
  .refine((d) => !d.ends_on || !d.starts_on || d.ends_on >= d.starts_on, "Päättymispäivä on ennen alkamispäivää.");

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata sopimuksia.");
  return ctx;
}

type ContractData = z.infer<typeof contractSchema>;

function values(d: ContractData) {
  const reminder = d.reminder_on ?? defaultReminderOn(d.ends_on, d.notice_months);
  return [d.company_id, d.counterparty, d.category, d.description, d.starts_on, d.ends_on, d.notice_months, d.annual_cost_eur, d.document_id, reminder, d.status];
}

async function checkDocument(tx: Sql, d: ContractData, back: string) {
  if (!d.document_id) return;
  const rows = await tx.query("select 1 from er_documents where id = $1 and company_id = $2", [d.document_id, d.company_id]);
  if (rows.length === 0) fail(back, "Liitetty dokumentti ei kuulu valitulle yhtiölle.");
}

export async function createContractAction(formData: FormData) {
  const back = "/sopimukset/uusi";
  const ctx = await writer(back);
  const data = parseForm(contractSchema, formData, back);
  const id = await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [data.company_id]);
    if (!company) fail(back, "Yhtiötä ei löytynyt.");
    await checkDocument(tx, data, back);
    const [row] = await tx.query<{ id: string }>(
      `insert into er_contracts (company_id, counterparty, category, description, starts_on, ends_on, notice_months, annual_cost_eur, document_id, reminder_on, status,
          organization_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [...values(data), company.organization_id, ctx.user.id],
    );
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create", entity: "contract", entityId: row.id });
    return row.id;
  });
  revalidatePath("/sopimukset");
  redirect(`/sopimukset/${id}`);
}

export async function updateContractAction(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/sopimukset/${id}`;
  const ctx = await writer(back);
  const data = parseForm(contractSchema, formData, back);
  await ctx.run(async (tx) => {
    await checkDocument(tx, data, back);
    // Muistutus lähtee uudelleen, jos sen päivä muuttuu.
    const rows = await tx.query<{ organization_id: string }>(
      `update er_contracts set company_id=$2, counterparty=$3, category=$4, description=$5, starts_on=$6, ends_on=$7, notice_months=$8,
              annual_cost_eur=$9, document_id=$10,
              reminded_at = case when reminder_on is distinct from $11::date then null else reminded_at end,
              reminder_on=$11, status=$12
        where id=$1 returning organization_id`,
      [id, ...values(data)],
    );
    if (rows.length === 0) fail("/sopimukset", "Sopimusta ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "contract", entityId: id, details: { status: data.status } });
  });
  revalidatePath("/sopimukset");
  redirect(`/sopimukset/${id}?tallennettu=1`);
}

export async function deleteContractAction(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const ctx = await writer(`/sopimukset/${id}`);
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>("delete from er_contracts where id = $1 returning organization_id", [id]);
    if (rows.length) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete", entity: "contract", entityId: id });
  });
  revalidatePath("/sopimukset");
  redirect("/sopimukset");
}
