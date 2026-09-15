"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { isIsoDate } from "@/lib/tasks/dates";
import { TASK_CATEGORIES } from "@/lib/tasks/labels";
import { completeTask, createAnnualCycleForCompany, insertTask } from "@/lib/tasks/queries";
import { normalizeRecurrence, type Recurrence } from "@/lib/tasks/recurrence";

const uuid = z.string().uuid();
const optUuid = z.preprocess(emptyToNull, uuid.nullable());

/**
 * Paluuosoite vain vuosikellon sisällä (globaali tai yhtiön vuosikello),
 * jottei lomakkeella voi ohjata muualle.
 */
function safeBack(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  if (v.includes("//") || v.includes("\\")) return "/vuosikello";
  return /^\/vuosikello(?:[/?]|$)/.test(v) || /^\/taloyhtiot\/[0-9a-f-]{36}\/vuosikello(?:\?|$)/i.test(v) ? v : "/vuosikello";
}

const taskSchema = z.object({
  title: z.string().min(1, "Anna tehtävän nimi.").max(200),
  company_id: optUuid,
  category: z.enum(TASK_CATEGORIES),
  due_on: z.string().refine(isIsoDate, "Anna eräpäivä."),
  assignee_user_id: optUuid,
  freq: z.enum(["none", "yearly", "monthly", "weekly"]).default("none"),
  interval: z.preprocess(emptyToNull, z.coerce.number().int().min(1, "Toistoväli on vähintään 1.").max(120).nullable()),
  description: z.preprocess(emptyToNull, z.string().max(4000).nullable()),
});

function ruleFrom(data: z.infer<typeof taskSchema>): Recurrence | null {
  return data.freq === "none" ? null : { freq: data.freq, interval: data.interval ?? 1 };
}

function writeError(back: string, err: unknown): never {
  if (err instanceof Error && /row-level security/.test(err.message)) fail(back, "Tarkista yhtiö ja vastuuhenkilö.");
  throw err;
}

export async function createTaskAction(formData: FormData) {
  const ctx = await requireStaff();
  const back = "/vuosikello/uusi";
  const data = parseForm(taskSchema, formData, back);
  try {
    await ctx.run(async (tx) => {
      const id = await insertTask(tx, {
        organizationId: ctx.org.organizationId, companyId: data.company_id, title: data.title, description: data.description,
        dueOn: data.due_on, recurrence: ruleFrom(data), category: data.category, assigneeUserId: data.assignee_user_id, createdBy: ctx.user.id,
      });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "create", entity: "task", entityId: id });
    });
  } catch (err) {
    writeError(back, err);
  }
  revalidatePath("/vuosikello");
  redirect("/vuosikello");
}

export async function updateTaskAction(formData: FormData) {
  const ctx = await requireStaff();
  const id = uuid.parse(formData.get("id"));
  const back = `/vuosikello/${id}`;
  const data = parseForm(taskSchema, formData, back);
  const rule = ruleFrom(data);
  try {
    const rows = await ctx.run(async (tx) => {
      const r = await tx.query<{ organization_id: string }>(
        `update er_tasks set title=$2, company_id=$3, category=$4, due_on=$5, assignee_user_id=$6, recurrence=$7, description=$8,
                last_reminded_on = case when due_on is distinct from $5::date then null else last_reminded_on end
          where id=$1 and done_at is null returning organization_id`,
        [id, data.title, data.company_id, data.category, data.due_on, data.assignee_user_id,
          rule ? JSON.stringify(normalizeRecurrence(rule, data.due_on)) : null, data.description],
      );
      if (r.length) await audit(tx, { organizationId: r[0].organization_id, userId: ctx.user.id, action: "update", entity: "task", entityId: id });
      return r;
    });
    if (rows.length === 0) fail("/vuosikello", "Tehtävää ei löytynyt tai se on jo kuitattu.");
  } catch (err) {
    writeError(back, err);
  }
  revalidatePath("/vuosikello");
  redirect("/vuosikello");
}

export async function deleteTaskAction(formData: FormData) {
  const ctx = await requireStaff();
  const id = uuid.parse(formData.get("id"));
  await ctx.run(async (tx) => {
    const r = await tx.query<{ organization_id: string; title: string }>("delete from er_tasks where id = $1 returning organization_id, title", [id]);
    if (r.length) await audit(tx, { organizationId: r[0].organization_id, userId: ctx.user.id, action: "delete", entity: "task", entityId: id });
  });
  revalidatePath("/vuosikello");
  redirect("/vuosikello");
}

export async function completeTaskAction(formData: FormData) {
  const ctx = await requireStaff();
  const id = uuid.parse(formData.get("id"));
  const back = safeBack(formData.get("back"));
  await ctx.run(async (tx) => {
    const res = await completeTask(tx, { taskId: id, userId: ctx.user.id });
    if (res.completed && res.organizationId) {
      await audit(tx, { organizationId: res.organizationId, userId: ctx.user.id, action: "complete", entity: "task", entityId: id, details: res.nextId ? { next_task_id: res.nextId } : {} });
    }
  });
  revalidatePath("/vuosikello");
  revalidatePath("/tyopoyta");
  redirect(back);
}

export async function reopenTaskAction(formData: FormData) {
  const ctx = await requireStaff();
  const id = uuid.parse(formData.get("id"));
  await ctx.run(async (tx) => {
    // Toistuvan tehtävän seuraava esiintymä jää, jos se on jo luotu; avataan vain tämä.
    const r = await tx.query<{ organization_id: string }>("update er_tasks set done_at = null, done_by = null where id = $1 and done_at is not null returning organization_id", [id]);
    if (r.length) await audit(tx, { organizationId: r[0].organization_id, userId: ctx.user.id, action: "reopen", entity: "task", entityId: id });
  });
  revalidatePath("/vuosikello");
  redirect("/vuosikello?kuitatut=1");
}

const cycleSchema = z.object({ company_id: z.string().uuid("Valitse yhtiö."), assignee_user_id: optUuid });

export async function createAnnualCycleAction(formData: FormData) {
  const ctx = await requireStaff();
  const base = safeBack(formData.get("back")).split("?")[0];
  const data = parseForm(cycleSchema, formData, base);
  let result: Awaited<ReturnType<typeof createAnnualCycleForCompany>> = null;
  try {
    result = await ctx.run(async (tx) => {
      const r = await createAnnualCycleForCompany(tx, { companyId: data.company_id, userId: ctx.user.id, today: isoDateHelsinki(), assigneeUserId: data.assignee_user_id });
      if (r) await audit(tx, { organizationId: r.organizationId, userId: ctx.user.id, action: "create_annual_cycle", entity: "housing_company", entityId: data.company_id, details: { created: r.created } });
      return r;
    });
  } catch (err) {
    writeError(base, err);
  }
  if (!result) fail(base, "Yhtiötä ei löytynyt.");
  revalidatePath("/vuosikello");
  redirect(base === "/vuosikello" ? `/vuosikello?yhtio=${data.company_id}&luotu=${result.created}` : `${base}?luotu=${result.created}`);
}
