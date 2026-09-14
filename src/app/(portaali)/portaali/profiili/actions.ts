"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortal } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { setOwnNoticeConsent, updateOwnProfile } from "@/lib/settings/profile";

const BACK = "/portaali/profiili";

export async function saveProfile(formData: FormData) {
  const ctx = await requirePortal();
  const data = parseForm(
    z.object({
      full_name: z.preprocess(emptyToNull, z.string().max(200).nullable()),
      phone: z.preprocess(emptyToNull, z.string().max(40).regex(/^[+\d\s()-]+$/, "Tarkista puhelinnumero.").nullable()),
    }),
    formData,
    BACK,
  );
  await updateOwnProfile(ctx.db, ctx.user, { fullName: data.full_name, phone: data.phone });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=1`);
}

export async function saveConsent(formData: FormData) {
  const ctx = await requirePortal();
  const partyId = z.string().uuid().safeParse(formData.get("party_id"));
  if (!partyId.success) fail(BACK, "Tietoja ei voitu tallentaa.");
  // Palvelun rooli, mutta päivitys rajataan istunnon käyttäjän omiin riveihin (src/lib/settings/profile.ts).
  await setOwnNoticeConsent(ctx.db, ctx.user, partyId.data, formData.get("consent") === "on");
  revalidatePath(BACK);
  redirect(`${BACK}?ok=1`);
}
