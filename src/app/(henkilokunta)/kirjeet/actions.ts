"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { cancelLetters, confirmLetters, LetterError, refreshLetterJob } from "@/lib/letters/jobs";
import { safeLetterBack } from "@/lib/letters/labels";
import { assertRealPostita, getPostitaClient, isPostitaError } from "@/lib/postita";

/**
 * Kirjetyön vahvistus, peruutus ja tilan päivitys kokous- ja tiedotesivulta.
 * Työ luetaan käyttäjän RLS-transaktiossa, joten toisen organisaation työtä
 * ei löydy. Postitus maksaa ja lähtee yhtiön nimissä, joten toiminnot tekee
 * pääkäyttäjä tai isännöitsijä.
 */

async function manager(formData: FormData) {
  const back = safeLetterBack(formData.get("back"));
  if (!back) redirect("/tyopoyta");
  const jobId = z.string().uuid().safeParse(formData.get("job_id"));
  if (!jobId.success) fail(back, "Kirjetyötä ei löytynyt.");
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(back, "Kirjeet lähettää pääkäyttäjä tai isännöitsijä.");
  return { ctx, back, jobId: jobId.data };
}

function handle(back: string, err: unknown): never {
  if (err instanceof LetterError) fail(back, err.message);
  if (isPostitaError(err)) fail(back, err.message);
  throw err;
}

function done(back: string, flag: string): never {
  revalidatePath(back);
  redirect(`${back}?kirjeet=${flag}#kirjeet`);
}

export async function confirmLetterJobAction(formData: FormData) {
  const { ctx, back, jobId } = await manager(formData);
  try {
    assertRealPostita();
    await confirmLetters(ctx.run, getPostitaClient(), { userId: ctx.user.id, jobId });
  } catch (err) {
    handle(back, err);
  }
  done(back, "vahvistettu");
}

export async function cancelLetterJobAction(formData: FormData) {
  const { ctx, back, jobId } = await manager(formData);
  try {
    await cancelLetters(ctx.run, getPostitaClient(), { userId: ctx.user.id, jobId });
  } catch (err) {
    handle(back, err);
  }
  done(back, "peruttu");
}

export async function refreshLetterJobAction(formData: FormData) {
  const { ctx, back, jobId } = await manager(formData);
  try {
    await refreshLetterJob(ctx.run, getPostitaClient(), { userId: ctx.user.id, jobId });
  } catch (err) {
    handle(back, err);
  }
  done(back, "paivitetty");
}
