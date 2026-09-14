"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortal } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { MaintenanceError, submitNotice } from "@/lib/maintenance/mutations";
import { WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";

const BACK = "/portaali/muutostyot/uusi";
const optDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivämäärä.").nullable());

const schema = z.object({
  share_group_id: z.string().uuid("Valitse huoneisto."),
  work_type: z.preprocess(emptyToNull, z.string().refine((v) => WORK_TYPE_LABELS.includes(v), "Valitse työlaji luettelosta.").nullable()),
  description: z.string().min(10, "Kuvaa muutostyö tarkemmin: mitä tehdään, missä ja kuka tekee.").max(4000),
  planned_start: optDate,
  planned_end: optDate,
});

/**
 * Osakkaan muutostyöilmoitus. Huoneisto tarkistetaan portaalioikeuksista,
 * ja kanta tarkistaa saman uudelleen (RLS: vain osakas omaan huoneistoonsa).
 */
export async function submitRenovationNotice(formData: FormData) {
  const ctx = await requirePortal();
  const d = parseForm(schema, formData, BACK);
  const owns = ctx.user.portal.some((g) => g.role === "owner" && g.shareGroupId === d.share_group_id);
  if (!owns) fail(BACK, "Voit tehdä ilmoituksen vain huoneistosta, jonka osakas olet.");
  if (d.planned_start && d.planned_end && d.planned_end < d.planned_start) fail(BACK, "Päättymispäivä ei voi olla ennen aloitusta.");

  let message: string | null = null;
  try {
    await ctx.run((tx) =>
      submitNotice(tx, { userId: ctx.user.id, shareGroupId: d.share_group_id, description: d.description, workType: d.work_type, plannedStart: d.planned_start, plannedEnd: d.planned_end }),
    );
  } catch (err) {
    if (err instanceof MaintenanceError) message = err.message;
    else throw err;
  }
  if (message) fail(BACK, message);
  revalidatePath("/portaali/muutostyot");
  redirect("/portaali/muutostyot?tila=lahetetty");
}
