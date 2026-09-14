"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { MAX_CSV_ROWS, parseConsumptionCsv, parseFinnishNumber, resolveCompany } from "@/lib/consumption/csv";
import { UTILITIES } from "@/lib/consumption/labels";
import { upsertReading } from "@/lib/consumption/queries";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { listCompanies } from "@/lib/registry/queries";
import { isIsoDate } from "@/lib/tasks/dates";

const uuid = z.string().uuid();
const MAX_CSV_BYTES = 1_000_000;

function back(companyId: string | null, utility?: string | null, extra = "") {
  const p = new URLSearchParams();
  if (companyId) p.set("yhtio", companyId);
  if (utility && (UTILITIES as readonly string[]).includes(utility)) p.set("laji", utility);
  const q = p.toString();
  return `/kulutus${q ? `?${q}` : ""}${extra ? `${q ? "&" : "?"}${extra}` : ""}`;
}

const readingSchema = z
  .object({
    company_id: z.string().uuid("Valitse yhtiö."),
    utility: z.enum(UTILITIES),
    period_start: z.string().refine(isIsoDate, "Anna jakson alkupäivä."),
    period_end: z.string().refine(isIsoDate, "Anna jakson loppupäivä."),
    amount: z.string().transform((v, c) => {
      const n = parseFinnishNumber(v);
      if (n === null || n < 0) {
        c.addIssue({ code: "custom", message: "Määrä ei ole kelvollinen luku." });
        return z.NEVER;
      }
      return n;
    }),
    unit: z.enum(["kWh", "MWh", "m3"]),
    cost_eur: z.preprocess(emptyToNull, z.string().nullable()).transform((v, c) => {
      if (v === null) return null;
      const n = parseFinnishNumber(v);
      if (n === null || n < 0) {
        c.addIssue({ code: "custom", message: "Kustannus ei ole kelvollinen luku." });
        return z.NEVER;
      }
      return n;
    }),
  })
  .refine((d) => d.period_end >= d.period_start, "Loppupäivä on ennen alkupäivää.")
  .refine((d) => (d.utility === "water") === (d.unit === "m3"), "Veden yksikkö on m³, sähkön ja lämmön kWh tai MWh.");

export async function addReadingAction(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.safeParse(formData.get("company_id"));
  const to = back(companyId.success ? companyId.data : null, String(formData.get("utility") ?? ""));
  const data = parseForm(readingSchema, formData, to);
  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [data.company_id]);
    if (!company) fail("/kulutus", "Yhtiötä ei löytynyt.");
    await upsertReading(tx, {
      organizationId: company.organization_id, companyId: data.company_id, utility: data.utility, periodStart: data.period_start, periodEnd: data.period_end,
      amount: data.amount, unit: data.unit, costEur: data.cost_eur, source: "manual", createdBy: ctx.user.id,
    });
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "upsert", entity: "consumption_reading", entityId: data.company_id });
  });
  revalidatePath("/kulutus");
  redirect(back(data.company_id, data.utility, `vuosi=${data.period_start.slice(0, 4)}&tallennettu=1`));
}

export async function importCsvAction(formData: FormData) {
  const ctx = await requireStaff();
  const selected = uuid.safeParse(formData.get("company_id"));
  const to = back(selected.success ? selected.data : null);

  let text = String(formData.get("csv_text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) fail(to, "Tiedosto on liian suuri (enintään 1 Mt).");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Tyyppi tarkistetaan sisällöstä: tekstitiedostossa ei ole nollatavuja.
    if (bytes.includes(0)) fail(to, "Tiedosto ei ole CSV-tekstitiedosto.");
    text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (!text.trim()) fail(to, "Valitse CSV-tiedosto tai liitä rivit tekstikenttään.");
  if (text.length > MAX_CSV_BYTES) fail(to, "Tuonti on liian suuri (enintään 1 Mt).");

  const { rows, errors } = parseConsumptionCsv(text);
  if (errors.length) {
    fail(to, `Tuontia ei tehty. ${errors.slice(0, 3).map((e) => `Rivi ${e.line}: ${e.message}`).join(" ")}${errors.length > 3 ? ` (yhteensä ${errors.length} virhettä)` : ""}`);
  }
  if (rows.length === 0) fail(to, "Tiedostossa ei ollut lukemarivejä.");
  if (rows.length > MAX_CSV_ROWS) fail(to, `Enintään ${MAX_CSV_ROWS} riviä kerralla.`);

  const result = await ctx.run(async (tx) => {
    const companies = await listCompanies(tx, ctx.org.organizationId);
    const resolved = rows.map((r) => ({ r, company: resolveCompany(r.company, companies) }));
    const missing = resolved.filter((x) => !x.company);
    if (missing.length) {
      fail(to, `Tuontia ei tehty. Yhtiötä ei tunnistettu riveillä ${missing.slice(0, 5).map((x) => x.r.line).join(", ")}. Käytä Y-tunnusta tai yhtiön nimeä.`);
    }
    let inserted = 0;
    let updated = 0;
    for (const { r, company } of resolved) {
      const res = await upsertReading(tx, {
        organizationId: ctx.org.organizationId, companyId: company!.id, utility: r.utility, periodStart: r.periodStart, periodEnd: r.periodEnd,
        amount: r.amount, unit: r.unit, costEur: r.costEur, source: "csv", createdBy: ctx.user.id,
      });
      if (res === "inserted") inserted++;
      else updated++;
    }
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "import_csv", entity: "consumption_reading", details: { inserted, updated } });
    return { inserted, updated, companyId: resolved[0].company!.id };
  });
  revalidatePath("/kulutus");
  redirect(back(selected.success ? selected.data : result.companyId, null, `tuotu=${result.inserted}&paivitetty=${result.updated}`));
}

export async function deleteReadingAction(formData: FormData) {
  const ctx = await requireStaff();
  const id = uuid.parse(formData.get("id"));
  const rows = await ctx.run(async (tx) => {
    const r = await tx.query<{ organization_id: string; company_id: string; utility: string; year: string }>(
      "delete from er_consumption_readings where id = $1 returning organization_id, company_id, utility, to_char(period_start, 'YYYY') as year",
      [id],
    );
    if (r.length) await audit(tx, { organizationId: r[0].organization_id, userId: ctx.user.id, action: "delete", entity: "consumption_reading", entityId: id });
    return r;
  });
  revalidatePath("/kulutus");
  redirect(rows[0] ? back(rows[0].company_id, rows[0].utility, `vuosi=${rows[0].year}`) : "/kulutus");
}
