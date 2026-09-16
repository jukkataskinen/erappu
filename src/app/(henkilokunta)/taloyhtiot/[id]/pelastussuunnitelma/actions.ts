"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail, formObject } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { finalizePlan } from "@/lib/rescue-plans/document";
import { contentFromForm, planMetaSchema, PlanFormError } from "@/lib/rescue-plans/form";
import { buildPrefill, refreshFromRegistry } from "@/lib/rescue-plans/prefill";
import {
  createDraft,
  currentAndDraft,
  deleteDraft,
  getPlan,
  listAttachmentCandidates,
  listPlans,
  RescuePlanError,
  saveDraft,
} from "@/lib/rescue-plans/queries";
import { loadRegistrySnapshot } from "@/lib/rescue-plans/registry";

const uuid = z.string().uuid();
const page = (id: string) => `/taloyhtiot/${id}/pelastussuunnitelma`;
const draftPage = (id: string) => `${page(id)}/luonnos`;

async function writer(companyId: string, back: string) {
  const ctx = await requireStaff();
  // Pelastussuunnitelma on rekisterin tapaan pääkäyttäjän, isännöitsijän ja avustajan (0092).
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata pelastussuunnitelmaa.");
  return ctx;
}

async function guarded(back: string, fn: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof RescuePlanError || err instanceof PlanFormError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
}

/** Uusi luonnos: ensimmäinen esitäytetään rekisteristä, seuraavat kopioivat voimassa olevan version. */
export async function startRescuePlanDraft(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const ctx = await writer(companyId, page(companyId));
  const today = isoDateHelsinki();
  await guarded(page(companyId), () =>
    ctx.run(async (tx) => {
      const snapshot = await loadRegistrySnapshot(tx, companyId, today);
      if (!snapshot) throw new RescuePlanError("Yhtiötä ei löytynyt.");
      const { current } = currentAndDraft(await listPlans(tx, companyId));
      const content = current ? refreshFromRegistry(current.content, snapshot) : buildPrefill(snapshot);
      const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
      await createDraft(tx, { organizationId: company.organization_id, companyId, userId: ctx.user.id, content, visibility: current?.visibility });
    }),
  );
  revalidatePath(page(companyId));
  redirect(draftPage(companyId));
}

/**
 * Luonnoksen tallennus. `intent`: save (tallenna), preview (tallenna ja
 * näytä esikatselulinkki), registry (päivitä rekisterikentät), finalize
 * (tallenna ja merkitse valmiiksi).
 */
export async function saveRescuePlanDraft(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const planId = uuid.parse(formData.get("plan_id"));
  const back = draftPage(companyId);
  const ctx = await writer(companyId, back);
  const form = formObject(formData);
  const intent = z.enum(["save", "preview", "registry", "finalize"]).catch("save").parse(form.intent);
  const meta = planMetaSchema.safeParse(form);
  if (!meta.success) fail(back, meta.error.issues[0]?.message ?? "Tarkista päivämäärät.");
  const dates = meta.data;
  const today = isoDateHelsinki();

  await guarded(back, () =>
    ctx.run(async (tx) => {
      const plan = await getPlan(tx, planId);
      if (!plan || plan.company_id !== companyId || plan.status !== "draft") throw new RescuePlanError("Luonnosta ei löytynyt. Se on ehkä jo merkitty valmiiksi.");
      const candidates = await listAttachmentCandidates(tx, companyId);
      let content = contentFromForm(form, candidates.map((c) => c.id));
      if (intent === "registry") {
        const snapshot = await loadRegistrySnapshot(tx, companyId, today);
        if (snapshot) content = refreshFromRegistry(content, snapshot);
      }
      await saveDraft(tx, {
        planId, userId: ctx.user.id, content,
        preparedOn: dates.prepared_on, nextReviewOn: dates.next_review_on, visibility: dates.visibility,
      });
    }),
  );

  if (intent === "finalize") {
    let warnings: string[] = [];
    let announcementId: string | null = null;
    await guarded(back, async () => {
      const result = await finalizePlan(ctx.run, { planId, userId: ctx.user.id });
      warnings = result.warnings;
      announcementId = result.announcementId;
    });
    revalidatePath(page(companyId));
    const extra = `${warnings.length ? "&liitevaroitus=1" : ""}${announcementId ? `&tiedote=${announcementId}` : ""}`;
    redirect(`${page(companyId)}?tila=valmis${extra}`);
  }
  revalidatePath(back);
  redirect(`${back}?tila=${intent === "preview" ? "esikatselu" : intent === "registry" ? "rekisteri" : "tallennettu"}`);
}

export async function deleteRescuePlanDraft(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const planId = uuid.parse(formData.get("plan_id"));
  const ctx = await writer(companyId, page(companyId));
  await ctx.run((tx) => deleteDraft(tx, { planId, userId: ctx.user.id }));
  revalidatePath(page(companyId));
  redirect(`${page(companyId)}?tila=poistettu`);
}
