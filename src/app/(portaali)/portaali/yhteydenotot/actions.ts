"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth/current-user";
import { newContactSchema, parseTarget, replySchema } from "@/lib/contacts/labels";
import { ContactError, createThread, postMessage } from "@/lib/contacts/mutations";
import { fail, parseForm } from "@/lib/forms";
import { attachmentFiles } from "@/lib/maintenance/attachments";

/**
 * Portaalin yhteydenotot. Kohde tarkistetaan portaalioikeuksista, ja kanta
 * tarkistaa saman uudelleen (0095: vain oma yhtiö ja oma huoneisto).
 */

export async function createContact(formData: FormData) {
  const back = "/portaali/yhteydenotot/uusi";
  const ctx = await requirePortal();
  const d = parseForm(newContactSchema, formData, back);
  const target = parseTarget(d.target);
  const grant =
    target.kind === "unit"
      ? ctx.user.portal.find((g) => g.shareGroupId === target.id && (g.role === "owner" || g.role === "resident"))
      : ctx.user.portal.find((g) => g.companyId === target.id && g.role !== "provider");
  if (!grant) fail(back, "Valitse yhtiö tai huoneisto, johon sinulla on oikeus.");

  let id: string | null = null;
  let message: string | null = null;
  try {
    id = await ctx.run((tx) =>
      createThread(tx, {
        userId: ctx.user.id,
        companyId: grant.companyId,
        shareGroupId: target.kind === "unit" ? target.id : null,
        topic: d.topic,
        subject: d.subject,
        body: d.body,
        files: attachmentFiles(formData),
      }),
    );
  } catch (err) {
    if (err instanceof ContactError) message = err.message;
    else throw err;
  }
  if (message || !id) fail(back, message ?? "Yhteydenottoa ei voitu tallentaa.");
  revalidatePath("/portaali/yhteydenotot");
  redirect(`/portaali/yhteydenotot/${id}?tila=lahetetty`);
}

export async function replyContact(formData: FormData) {
  const ctx = await requirePortal();
  const threadId = String(formData.get("thread_id") ?? "");
  const back = /^[0-9a-f-]{36}$/i.test(threadId) ? `/portaali/yhteydenotot/${threadId}` : "/portaali/yhteydenotot";
  const d = parseForm(replySchema, formData, back);
  let message: string | null = null;
  try {
    await ctx.run((tx) => postMessage(tx, { threadId: d.thread_id, userId: ctx.user.id, fromStaff: false, body: d.body, files: attachmentFiles(formData) }));
  } catch (err) {
    if (err instanceof ContactError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
  revalidatePath(back);
  redirect(`${back}?tila=lahetetty#viestit`);
}
