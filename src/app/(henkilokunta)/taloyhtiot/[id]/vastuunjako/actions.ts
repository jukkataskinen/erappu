"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { findItem, RESPONSIBILITIES } from "@/lib/responsibility/content";
import { EXCEPTION_BASES } from "@/lib/responsibility/merge";
import { deleteException, saveException } from "@/lib/responsibility/queries";

const uuid = z.string().uuid();
const page = (id: string) => `/taloyhtiot/${id}/vastuunjako`;

async function writer(back: string) {
  const ctx = await requireStaff();
  // Sama rajaus kuin taulun RLS:ssä (0094): kirjanpitäjä ei muokkaa.
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata vastuunjakoa.");
  return ctx;
}

const saveSchema = z.object({
  company_id: uuid,
  item_key: z.string().refine((k) => Boolean(findItem(k)), "Valitse kohde luettelosta."),
  responsibility: z.enum(RESPONSIBILITIES, { message: "Valitse, kenen vastuulla kohde on." }),
  basis: z.enum(EXCEPTION_BASES, { message: "Valitse poikkeuksen peruste." }),
  note: z.string().min(1, "Kirjoita perustelu, esimerkiksi yhtiöjärjestyksen kohta tai päätöksen sisältö.").max(1000, "Perustelu saa olla enintään 1000 merkkiä."),
  decided_on: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivämäärä.").nullable()),
});

export async function saveResponsibilityException(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = page(companyId);
  const ctx = await writer(back);
  const input = parseForm(saveSchema, formData, back);
  // Sama vastuu kuin yleisessä tulkinnassa sallitaan: yhtiöjärjestys voi tarkentaa
  // jaettua vastuuta (esim. mikä osa pihasta on osakkaan) muuttamatta luokkaa.
  await ctx.run((tx) =>
    saveException(tx, {
      companyId,
      userId: ctx.user.id,
      itemKey: input.item_key,
      responsibility: input.responsibility,
      basis: input.basis,
      note: input.note,
      decidedOn: input.decided_on,
    }),
  );
  revalidatePath(back);
  revalidatePath("/portaali/vastuunjako");
  redirect(`${back}?tila=tallennettu#poikkeukset`);
}

const deleteSchema = z.object({ company_id: uuid, item_key: z.string().regex(/^[a-z0-9-]{1,80}$/) });

export async function deleteResponsibilityException(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = page(companyId);
  const ctx = await writer(back);
  const input = parseForm(deleteSchema, formData, back);
  await ctx.run((tx) => deleteException(tx, { companyId, userId: ctx.user.id, itemKey: input.item_key }));
  revalidatePath(back);
  revalidatePath("/portaali/vastuunjako");
  redirect(`${back}?tila=poistettu#poikkeukset`);
}
