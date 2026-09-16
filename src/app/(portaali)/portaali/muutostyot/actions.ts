"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth/current-user";
import { fail, parseForm } from "@/lib/forms";
import { AttachmentError, attachmentFiles, saveNoticeAttachments } from "@/lib/maintenance/attachments";
import { MaintenanceError, submitNotice } from "@/lib/maintenance/mutations";
import { noticeSchema, noticeWorkRowsFromValues, parseNoticeWorks, type RawNoticeWork } from "@/lib/maintenance/notice-form";
import { listRenovationGuides } from "@/lib/maintenance/queries";

const BACK = "/portaali/muutostyot/uusi";

/** Lomakkeen rinnakkaiset kentät työriveiksi (yksi arvo jokaisesta työlohkosta). */
function workRows(formData: FormData): RawNoticeWork[] {
  const values = (name: string) => formData.getAll(name).filter((v): v is string => typeof v === "string");
  return noticeWorkRowsFromValues({
    work_type: values("work_type"),
    description: values("work_description"),
    planned_start: values("work_planned_start"),
    planned_end: values("work_planned_end"),
    contractor_kind: values("contractor_kind"),
    contractor_name: values("contractor_name"),
    contractor_business_id: values("contractor_business_id"),
    contractor_contact: values("contractor_contact"),
    contractor_qualification: values("contractor_qualification"),
  });
}

/**
 * Osakkaan muutostyöilmoitus. Huoneisto tarkistetaan portaalioikeuksista, ja
 * kanta tarkistaa saman uudelleen (RLS: vain osakas omaan huoneistoonsa).
 * Muutostyöohje haetaan palvelimella valitun huoneiston yhtiöstä, jotta
 * kuittaus kohdistuu siihen ohjeeseen, jonka osakas lomakkeella näki.
 */
export async function submitRenovationNotice(formData: FormData) {
  const ctx = await requirePortal();
  const d = parseForm(noticeSchema, formData, BACK);
  const unit = ctx.user.portal.find((g) => g.role === "owner" && g.shareGroupId === d.share_group_id);
  if (!unit) fail(BACK, "Voit tehdä ilmoituksen vain huoneistosta, jonka osakas olet.");

  const parsed = parseNoticeWorks(workRows(formData));
  if ("error" in parsed) fail(BACK, parsed.error);
  const files = attachmentFiles(formData);

  let message: string | null = null;
  try {
    await ctx.run(async (tx) => {
      const [guide] = await listRenovationGuides(tx, [unit.companyId]);
      const notice = await submitNotice(tx, {
        userId: ctx.user.id,
        shareGroupId: d.share_group_id,
        description: d.description,
        works: parsed.value,
        guideDocumentId: guide?.id ?? null,
        guideAcknowledged: d.guide_ack,
        notifyEmail: d.notify_email,
        notifySms: d.notify_sms,
      });
      await saveNoticeAttachments(tx, files, {
        organizationId: notice.organizationId,
        companyId: notice.companyId,
        shareGroupId: notice.shareGroupId,
        noticeId: notice.id,
        userId: ctx.user.id,
      });
    });
  } catch (err) {
    if (err instanceof MaintenanceError || err instanceof AttachmentError) message = err.message;
    else throw err;
  }
  if (message) fail(BACK, message);
  revalidatePath("/portaali/muutostyot");
  redirect("/portaali/muutostyot?tila=lahetetty");
}
