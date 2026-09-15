"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { addNeed, MaintenanceError, processNotice, saveWork, setNeedStatus } from "@/lib/maintenance/mutations";
import { WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";

const uuid = z.string().uuid();
const optText = (max = 2000) => z.preprocess(emptyToNull, z.string().max(max).nullable());
const optDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivämäärä.").nullable());
const optMoney = z.preprocess((v) => (typeof v === "string" ? emptyToNull(v.replace(/\s/g, "").replace(",", ".")) : v), z.coerce.number().min(0, "Summa ei voi olla negatiivinen.").max(1e11).nullable());
const workType = z.string().refine((v) => WORK_TYPE_LABELS.includes(v), "Valitse työlaji luettelosta.");

const page = (id: string) => `/taloyhtiot/${id}/korjaukset`;

async function writer(companyId: string) {
  const ctx = await requireStaff();
  // Korjaushistoria ja selvitys ovat HTJ2-tietoja, joita myös kirjanpitäjä ylläpitää (0004).
  if (!ctx.can("owner", "manager", "assistant", "accountant")) fail(page(companyId), "Roolillasi ei voi muokata korjaustietoja.");
  return ctx;
}

async function guarded(back: string, fn: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof MaintenanceError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
}

const workSchema = z.object({
  project: z.string().min(2, "Anna hankkeen nimi.").max(200),
  work_type: workType,
  completed_year: z.preprocess(emptyToNull, z.coerce.number().int().min(1900, "Tarkista valmistumisvuosi.").max(2100).nullable()),
  completed_on: optDate,
  cost_eur: optMoney,
  description: optText(),
  performed_by: z.enum(["company", "shareholder"]),
  share_group_id: z.preprocess(emptyToNull, uuid.nullable()),
});

export async function saveMaintenanceWork(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const ctx = await writer(companyId);
  const id = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const back = id ? `${page(companyId)}?muokkaa=${id}` : page(companyId);
  const d = parseForm(workSchema, formData, back);
  if (d.completed_year === null && d.completed_on === null) fail(back, "Anna valmistumisvuosi. HTJ edellyttää sen.");
  if (d.performed_by === "shareholder" && !d.share_group_id) fail(back, "Valitse huoneisto, kun työn on tehnyt osakas.");
  await guarded(back, () =>
    ctx.run((tx) =>
      saveWork(tx, {
        companyId, id, userId: ctx.user.id,
        input: { project: d.project, workType: d.work_type, completedYear: d.completed_year, completedOn: d.completed_on, costEur: d.cost_eur, description: d.description, performedBy: d.performed_by, shareGroupId: d.share_group_id },
      }),
    ),
  );
  revalidatePath(page(companyId));
  redirect(`${page(companyId)}?tila=tyo`);
}

const needSchema = z.object({
  planned_year: z.coerce.number().int().min(2000).max(2100),
  target: z.string().min(2, "Anna kohde.").max(200),
  action: z.string().min(2, "Anna toimenpide.").max(500),
  work_type: z.preprocess(emptyToNull, workType.nullable()),
  estimate_eur: optMoney,
  affects_residents: z.preprocess((v) => v === "on", z.boolean()),
});

export async function addMaintenanceNeed(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const ctx = await writer(companyId);
  const back = page(companyId);
  const d = parseForm(needSchema, formData, back);
  await guarded(back, () =>
    ctx.run((tx) =>
      addNeed(tx, { companyId, userId: ctx.user.id, input: { plannedYear: d.planned_year, target: d.target, action: d.action, workType: d.work_type, estimateEur: d.estimate_eur, affectsResidents: d.affects_residents } }),
    ),
  );
  revalidatePath(back);
  redirect(`${back}?tila=kpts`);
}

const needStatusSchema = z.object({
  id: uuid,
  status: z.enum(["planned", "decided", "in_progress", "done", "postponed", "cancelled"]),
  planned_year: z.preprocess(emptyToNull, z.coerce.number().int().min(2000).max(2100).nullable()),
  decided_on: optDate,
});

export async function updateMaintenanceNeed(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const ctx = await writer(companyId);
  const back = page(companyId);
  const d = parseForm(needStatusSchema, formData, back);
  // Päätöspäivä päivitetään vain lomakkeelta, jossa kenttä on; muuten aiempi arvo säilyy.
  const decidedOn = formData.has("decided_on") ? d.decided_on : undefined;
  await guarded(back, () =>
    ctx.run((tx) =>
      setNeedStatus(tx, { id: d.id, companyId, userId: ctx.user.id, status: d.status, plannedYear: d.planned_year, completedYear: d.status === "done" ? Number(isoDateHelsinki().slice(0, 4)) : null, decidedOn }),
    ),
  );
  revalidatePath(back);
  redirect(`${back}?tila=${d.status === "done" ? "kpts-valmis" : "kpts"}`);
}

const surveySchema = z.object({
  maintenance_needs_report_on: optDate,
  maintenance_plan_on: optDate,
  maintenance_plan_summary: optText(2000),
});

/** Kunnossapitotarveselvityksen ja -suunnitelman päivät (VNa 365/2010 5 § 9–10 kohta). Yhtiörivi: rekisterin kirjoittajat. */
export async function saveMaintenanceSurveys(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = page(companyId);
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Selvitysten tiedot päivittää isännöitsijä.");
  const d = parseForm(surveySchema, formData, back);
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_housing_companies set maintenance_needs_report_on = $2, maintenance_plan_on = $3, maintenance_plan_summary = $4 where id = $1 returning organization_id",
      [companyId, d.maintenance_needs_report_on, d.maintenance_plan_on, d.maintenance_plan_summary],
    );
    if (rows.length === 0) fail(back, "Yhtiötä ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "maintenance_surveys", entityId: companyId });
  });
  revalidatePath(back);
  redirect(`${back}?tila=selvitykset`);
}

const noticeSchema = z.object({
  status: z.enum(["received", "info_requested", "approved", "approved_with_conditions", "denied", "in_progress", "completed", "cancelled"]),
  conditions: optText(4000),
  supervisor: optText(200),
  decided_on: optDate,
  completed_on: optDate,
});

export async function processRenovationNotice(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const id = uuid.parse(formData.get("id"));
  const back = `${page(companyId)}/muutostyot/${id}`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Muutostyöilmoitukset käsittelee isännöitsijä.");
  const d = parseForm(noticeSchema, formData, back);
  await guarded(back, () =>
    ctx.run((tx) =>
      processNotice(tx, { id, userId: ctx.user.id, today: isoDateHelsinki(), update: { status: d.status, conditions: d.conditions, supervisor: d.supervisor, decidedOn: d.decided_on, completedOn: d.completed_on } }),
    ),
  );
  revalidatePath(page(companyId));
  revalidatePath(back);
  redirect(`${back}?tila=tallennettu`);
}
