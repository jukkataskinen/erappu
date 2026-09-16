"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { FinanceError } from "@/lib/finance/billing";
import { parseReading, reportPortalReading } from "@/lib/water/mutations";

/**
 * Vesimittarin lukeman ilmoitus portaalissa. Kanta tarkistaa, että mittari
 * on käyttäjän huoneistossa ja kierros on auki (0100).
 */
export async function reportReadingAction(formData: FormData) {
  const back = "/portaali/oma";
  const ctx = await requirePortal();
  const roundId = String(formData.get("round_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(roundId)) fail(back, "Lukukierros puuttuu.");
  const entries: { meterId: string; value: string }[] = [];
  for (const [key, raw] of formData.entries()) {
    const m = /^reading_([0-9a-f-]{36})$/i.exec(key);
    if (!m || typeof raw !== "string" || raw.trim() === "") continue;
    const value = parseReading(raw);
    if (value === null) fail(back, `Lukema "${raw}" ei kelpaa. Kirjoita mittarin kuutiometrit numeroina, esim. 123,456.`);
    entries.push({ meterId: m[1], value });
  }
  if (entries.length === 0) fail(back, "Kirjoita vähintään yhden mittarin lukema.");
  let message: string | null = null;
  try {
    await ctx.run(async (tx) => {
      for (const e of entries) {
        const ok = await reportPortalReading(tx, {
          meterId: e.meterId,
          roundId,
          value: e.value,
          userId: ctx.user.id,
          confirmed: formData.get("confirm_readings") === "on",
        });
        if (!ok) throw new FinanceError("Lukeman ilmoitus ei ole enää auki tälle mittarille.");
      }
    });
  } catch (err) {
    if (err instanceof FinanceError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
  revalidatePath(back);
  redirect(`${back}?vesi=kiitos#vesi`);
}
