"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { safetySchema, saveSafetyInfo } from "@/lib/registry/safety";

/** Väestönsuoja, kokoontumispaikat ja pääsulut (0108). */
export async function saveSafety(formData: FormData) {
  const companyId = z.string().uuid().parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/kiinteisto`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata yhtiön tietoja.");
  const parsed = safetySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) fail(`${back}?muokkaa=turvallisuus`, parsed.error.issues[0]?.message ?? "Tarkista lomakkeen tiedot.");
  const info = parsed.data;
  const saved = await ctx.run((tx) => saveSafetyInfo(tx, { companyId, userId: ctx.user.id, info }));
  if (!saved) fail(back, "Yhtiötä ei löytynyt.");
  revalidatePath(back);
  redirect(`${back}#turvallisuus`);
}
