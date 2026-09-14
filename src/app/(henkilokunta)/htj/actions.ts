"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";
import { emptyToNull, fail } from "@/lib/forms";
import { getHtjClient, HtjError } from "@/lib/htj";
import { DiffApplyError, decideDiffs, runFetchSync } from "@/lib/htj/sync";
import { approveSubmission, discardDraft, markManualDone, prepareDraft, sendSubmission, SubmissionError } from "@/lib/htj/submissions";

/**
 * HTJ-toiminnot. Roolit tarkistetaan tässä selkeän virheilmoituksen vuoksi,
 * mutta varsinainen suoja on kannassa (0020): kirjanpitäjän transaktio ei
 * pysty hyväksymään eroja eikä ilmoituksia.
 */

const uuid = z.string().uuid();
const KINDS = ["charges", "loans", "loan_shares", "maintenance_works", "maintenance_needs"] as const;

const companyPage = (id: string) => `/taloyhtiot/${id}/htj`;

/** Paluuosoite vain sallituista poluista, ettei lomakkeella voi ohjata muualle. */
function backFrom(formData: FormData, companyId: string): string {
  const raw = String(formData.get("back") ?? "");
  return raw === "/htj" ? "/htj" : companyPage(companyId);
}

function requireRole(ctx: StaffContext, back: string, roles: ("owner" | "manager" | "accountant" | "assistant")[], message: string) {
  if (!ctx.can(...roles)) fail(back, message);
}

/** Tunnetut virheet käyttäjälle, muut eteenpäin (ei rakennetta näkyviin). */
function knownMessage(err: unknown): string | null {
  if (err instanceof SubmissionError || err instanceof DiffApplyError || err instanceof HtjError) return err.message;
  return null;
}

function done(path: string, state: string): never {
  revalidatePath(path);
  revalidatePath("/htj");
  redirect(`${path}?tila=${state}`);
}

export async function fetchFromHtj(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  requireRole(ctx, back, ["owner", "manager"], "Vain isännöitsijä tai pääkäyttäjä voi hakea tietoja HTJ:stä.");

  let message: string | null = null;
  let status = "haettu";
  try {
    const client = await getHtjClient();
    const res = await ctx.run((tx) => runFetchSync(tx, client, { companyId, userId: ctx.user.id }));
    if (res.status === "error") message = res.error ?? "Haku epäonnistui.";
    else if (res.diffCount === 0) status = "tasmaa";
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) {
    revalidatePath(back);
    fail(back, message);
  }
  done(back, status);
}

export async function decideHtjDiffs(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  requireRole(ctx, back, ["owner", "manager"], "Vain isännöitsijä tai pääkäyttäjä voi hyväksyä HTJ-eroja.");
  const decision = z.enum(["accept", "reject"]).parse(formData.get("decision"));
  const all = formData.get("scope") === "all";
  const ids = formData.getAll("diff_ids").map((v) => uuid.parse(v));
  if (!all && ids.length === 0) fail(back, "Valitse vähintään yksi ero.");

  let message: string | null = null;
  try {
    await ctx.run((tx) => decideDiffs(tx, { companyId, diffIds: all ? "all" : ids, decision, userId: ctx.user.id }));
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) fail(back, message);
  revalidatePath(`/taloyhtiot/${companyId}`);
  done(back, decision === "accept" ? "hyvaksytty" : "hylatty");
}

export async function prepareHtjSubmission(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  const kind = z.enum(KINDS).parse(formData.get("kind"));

  let message: string | null = null;
  try {
    await ctx.run((tx) => prepareDraft(tx, { companyId, kind, userId: ctx.user.id }));
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) fail(back, message);
  done(back, "luonnos");
}

export async function approveHtjSubmission(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  requireRole(ctx, back, ["owner", "manager"], "Vain isännöitsijä tai pääkäyttäjä voi hyväksyä ilmoituksen.");
  const id = uuid.parse(formData.get("id"));

  let message: string | null = null;
  try {
    await ctx.run((tx) => approveSubmission(tx, { id, userId: ctx.user.id }));
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) fail(back, message);
  done(back, "ilmoitus-hyvaksytty");
}

export async function discardHtjDraft(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  const id = uuid.parse(formData.get("id"));
  let message: string | null = null;
  try {
    await ctx.run((tx) => discardDraft(tx, { id, userId: ctx.user.id }));
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) fail(back, message);
  done(back, "luonnos-poistettu");
}

export async function sendHtjSubmission(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = companyPage(companyId);
  requireRole(ctx, back, ["owner", "manager"], "Vain isännöitsijä tai pääkäyttäjä voi lähettää ilmoituksen HTJ:hin.");
  const id = uuid.parse(formData.get("id"));

  let message: string | null = null;
  try {
    const client = await getHtjClient();
    const res = await ctx.run((tx) => sendSubmission(tx, client, { id, userId: ctx.user.id }));
    if (res.status !== "accepted") message = res.messages[0] ?? "HTJ ei vastaanottanut ilmoitusta.";
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) {
    revalidatePath(back);
    fail(back, message);
  }
  done(back, "lahetetty");
}

const manualSchema = z.object({ note: z.preprocess(emptyToNull, z.string().max(500).nullable()) });

export async function markHtjManualDone(formData: FormData) {
  const ctx = await requireStaff();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = backFrom(formData, companyId);
  requireRole(ctx, back, ["owner", "manager"], "Vain isännöitsijä tai pääkäyttäjä voi merkitä ilmoitukset tehdyiksi.");
  const { note } = manualSchema.parse({ note: String(formData.get("note") ?? "").trim() });

  let message: string | null = null;
  try {
    await ctx.run((tx) => markManualDone(tx, { companyId, userId: ctx.user.id, note }));
  } catch (err) {
    message = knownMessage(err);
    if (!message) throw err;
  }
  if (message) fail(back, message);
  done(back, "kasin");
}
