"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { CONTACT_TOPICS, MAX_CONTACT_BODY, replySchema } from "@/lib/contacts/labels";
import { ContactError, createStaffThread, postMessage, setThreadClosed } from "@/lib/contacts/mutations";
import { fail, parseForm } from "@/lib/forms";
import { attachmentFiles } from "@/lib/maintenance/attachments";

/** Henkilökunnan vastaus ja tilan muutos. RLS rajaa organisaation ketjuihin ja kirjoittaviin rooleihin (0095). */

const WRITE_ROLES = ["owner", "manager", "assistant", "accountant"] as const;

const threadPath = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? `/yhteydenotot/${id}` : "/yhteydenotot");

async function guarded(back: string, fn: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof ContactError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
}

export async function staffReply(formData: FormData) {
  const ctx = await requireStaff();
  const back = threadPath(String(formData.get("thread_id") ?? ""));
  if (!ctx.can(...WRITE_ROLES)) fail(back, "Roolillasi ei voi vastata yhteydenottoihin.");
  const d = parseForm(replySchema, formData, back);
  const close = formData.get("close") === "1";
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await postMessage(tx, { threadId: d.thread_id, userId: ctx.user.id, fromStaff: true, body: d.body, files: attachmentFiles(formData) });
      if (close) await setThreadClosed(tx, { threadId: d.thread_id, userId: ctx.user.id, closed: true });
    }),
  );
  revalidatePath("/yhteydenotot");
  redirect(`${back}?tila=${close ? "vastattu-suljettu" : "vastattu"}`);
}

const statusSchema = z.object({ thread_id: z.string().uuid(), closed: z.enum(["0", "1"]) });

export async function staffSetClosed(formData: FormData) {
  const ctx = await requireStaff();
  const back = threadPath(String(formData.get("thread_id") ?? ""));
  if (!ctx.can(...WRITE_ROLES)) fail(back, "Roolillasi ei voi muuttaa yhteydenoton tilaa.");
  const d = parseForm(statusSchema, formData, back);
  await guarded(back, () => ctx.run((tx) => setThreadClosed(tx, { threadId: d.thread_id, userId: ctx.user.id, closed: d.closed === "1" })));
  revalidatePath("/yhteydenotot");
  redirect(`${back}?tila=${d.closed === "1" ? "suljettu" : "avattu"}`);
}

const startSchema = z.object({
  company_id: z.string().uuid(),
  recipient: z.string().regex(/^[0-9a-f-]{36}\|([0-9a-f-]{36})?$/i, "Valitse vastaanottaja."),
  topic: z.enum(CONTACT_TOPICS, { message: "Valitse aihe." }),
  subject: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(3, "Kirjoita otsikko (vähintään 3 merkkiä).").max(200)),
  body: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, "Kirjoita viesti.").max(MAX_CONTACT_BODY)),
});

/** Henkilökunnan aloittama viesti portaalikäyttäjälle (0104). */
export async function staffStartThread(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = String(formData.get("company_id") ?? "");
  const back = /^[0-9a-f-]{36}$/i.test(companyId) ? `/yhteydenotot/uusi?yhtio=${companyId}` : "/yhteydenotot/uusi";
  if (!ctx.can(...WRITE_ROLES)) fail(back, "Roolillasi ei voi lähettää viestejä.");
  const d = parseForm(startSchema, formData, back);
  const [participantUserId, shareGroupId] = d.recipient.split("|");
  let id: string | null = null;
  await guarded(back, async () => {
    id = await ctx.run((tx) =>
      createStaffThread(tx, {
        userId: ctx.user.id, companyId: d.company_id, shareGroupId: shareGroupId || null, participantUserId, topic: d.topic, subject: d.subject, body: d.body,
        files: attachmentFiles(formData),
      }),
    );
  });
  revalidatePath("/yhteydenotot");
  redirect(`/yhteydenotot/${id}?tila=lahetetty`);
}
