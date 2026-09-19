"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { guideSettingsSchema } from "@/lib/maintenance/renovation-guide";
import { publishGuide, saveGuideSettings } from "@/lib/maintenance/renovation-guide-document";

const uuid = z.string().uuid();
const back = (id: string) => `/taloyhtiot/${id}/korjaukset/muutostyoohje`;

function settingsFrom(formData: FormData) {
  return guideSettingsSchema.safeParse({
    workTypes: formData.getAll("work_types").map(String),
    leadTime: formData.get("lead_time") ?? "",
    workingHours: formData.get("working_hours") ?? "",
    serviceContact: formData.get("service_contact") ?? "",
    waterShutoff: formData.get("water_shutoff") ?? "",
    waste: formData.get("waste") ?? "",
    processingFee: formData.get("processing_fee") ?? "",
    extra: formData.get("extra") ?? "",
  });
}

/** Tallentaa asetukset ja halutessa julkaisee ohjeen dokumentiksi. */
export async function saveRenovationGuide(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back(companyId), "Muutostyöohjeen laatii isännöitsijä.");
  const parsed = settingsFrom(formData);
  if (!parsed.success) fail(back(companyId), parsed.error.issues[0]?.message ?? "Tarkista kentät.");
  const settings = parsed.data;
  const saved = await ctx.run((tx) => saveGuideSettings(tx, { companyId, userId: ctx.user.id, settings }));
  if (!saved) fail(back(companyId), "Yhtiötä ei löytynyt.");
  const publish = formData.get("intent") === "publish";
  if (publish) {
    const docId = await publishGuide(ctx.run, { companyId, userId: ctx.user.id, issuedOn: isoDateHelsinki(), visibleToOwners: formData.get("visible") === "on" });
    if (!docId) fail(back(companyId), "Yhtiötä ei löytynyt.");
  }
  revalidatePath(back(companyId));
  revalidatePath(`/taloyhtiot/${companyId}/korjaukset`);
  redirect(`${back(companyId)}?tila=${publish ? "julkaistu" : "tallennettu"}`);
}
