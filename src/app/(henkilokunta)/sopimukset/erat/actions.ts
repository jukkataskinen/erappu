"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";
import {
  BatchError,
  cancelBatch,
  createBatch,
  generateBatch,
  renewBatch,
  sendBatch,
  setBatchCompanies,
  updateBatchDetails,
  updateBatchItems,
  type Actor,
} from "@/lib/contract-templates/batches";
import { canSimulateSigning, getEsinettiClient, isEsinettiError } from "@/lib/esinetti";
import { simulateSigning } from "@/lib/meetings/simulate";
import { fail } from "@/lib/forms";

const uuid = z.uuid();
const detailsSchema = z.object({
  title: z.string().trim().min(1, "Anna erälle otsikko.").max(200, "Otsikko on liian pitkä."),
  provider_id: z.preprocess((v) => (v === "" ? null : v), z.uuid("Valitse urakoitsija.").nullable()),
});

async function writer(back: string): Promise<{ ctx: StaffContext; actor: Actor }> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata sopimuksia.");
  return { ctx, actor: { userId: ctx.user.id, organizationId: ctx.org.organizationId, canManage: ctx.can("owner", "manager") } };
}

/** `prefix[kentta]` → { kentta: arvo }. Kenttänimet rajataan pohjan avainten muotoon. */
function prefixed(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^${prefix}\\[([a-z0-9_]{1,60})\\]$`);
  for (const [k, v] of formData.entries()) {
    const m = re.exec(k);
    if (m && typeof v === "string") out[m[1]] = v.trim();
  }
  return out;
}

/** `items[<yhtiö>][kentta]` → { yhtiö: { kentta: arvo } }. */
function itemValues(formData: FormData): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const re = /^items\[([0-9a-f-]{36})\]\[([a-z0-9_]{1,60})\]$/;
  for (const [k, v] of formData.entries()) {
    const m = re.exec(k);
    if (!m || typeof v !== "string") continue;
    (out[m[1]] ??= {})[m[2]] = v.trim();
  }
  return out;
}

function uuids(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success).slice(0, 500);
}

/** BatchError → käyttäjälle; muut virheet eteenpäin. Viestissä ei ole lomakkeen sisältöä. */
function handle(err: unknown, back: string): never {
  if (err instanceof BatchError) {
    const details = err.details.length ? ` ${err.details.slice(0, 3).join("; ")}${err.details.length > 3 ? ` (ja ${err.details.length - 3} muuta)` : ""}` : "";
    fail(back, `${err.message}${details}`);
  }
  if (isEsinettiError(err)) fail(back, err.message);
  throw err;
}

function done(path: string): never {
  revalidatePath("/sopimukset");
  revalidatePath("/sopimukset/erat");
  redirect(path);
}

export async function createBatchAction(formData: FormData) {
  const back = "/sopimukset/erat/uusi";
  const { ctx, actor } = await writer(back);
  const parsed = detailsSchema.safeParse({ title: formData.get("title"), provider_id: formData.get("provider_id") ?? "" });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Tarkista lomakkeen tiedot.");
  const templateKey = z.string().regex(/^[a-z0-9-]{1,60}$/).safeParse(formData.get("template_key"));
  if (!templateKey.success) fail(back, "Valitse sopimuspohja.");
  let id: string;
  try {
    id = await createBatch(ctx.run, actor, {
      templateKey: templateKey.data,
      title: parsed.data.title,
      providerId: parsed.data.provider_id,
      sharedRaw: prefixed(formData, "shared"),
      companyIds: uuids(formData, "company_ids"),
    });
  } catch (err) {
    handle(err, back);
  }
  done(`/sopimukset/erat/${id}#yhtiot`);
}

function batchId(formData: FormData): string {
  const parsed = uuid.safeParse(formData.get("batch_id"));
  if (!parsed.success) fail("/sopimukset/erat", "Erää ei löytynyt.");
  return parsed.data;
}

export async function updateBatchDetailsAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  const parsed = detailsSchema.safeParse({ title: formData.get("title"), provider_id: formData.get("provider_id") ?? "" });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Tarkista lomakkeen tiedot.");
  try {
    await updateBatchDetails(ctx.run, actor, id, { title: parsed.data.title, providerId: parsed.data.provider_id, sharedRaw: prefixed(formData, "shared") });
  } catch (err) {
    handle(err, back);
  }
  done(`${back}?tallennettu=1#tiedot`);
}

export async function setBatchCompaniesAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  try {
    await setBatchCompanies(ctx.run, actor, id, uuids(formData, "company_ids"));
  } catch (err) {
    handle(err, back);
  }
  done(`${back}?tallennettu=1#yhtiot`);
}

export async function updateBatchItemsAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  try {
    await updateBatchItems(ctx.run, actor, id, itemValues(formData));
  } catch (err) {
    handle(err, back);
  }
  done(`${back}?tallennettu=1#yhtiot`);
}

export async function generateBatchAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  let count: number;
  try {
    count = await generateBatch(ctx.run, actor, id);
  } catch (err) {
    if (err instanceof BatchError && err.details.length) fail(back, `${err.message} Puuttuvat tiedot on lueteltu kohdassa 3.`);
    handle(err, back);
  }
  done(`${back}?muodostettu=${count}#muodosta`);
}

export async function sendBatchAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  const all = formData.get("scope") !== "selected";
  const itemIds = all ? undefined : uuids(formData, "item_ids");
  if (itemIds && itemIds.length === 0) fail(back, "Valitse lähetettävät sopimukset.");
  let result: Awaited<ReturnType<typeof sendBatch>>;
  try {
    result = await sendBatch(ctx.run, actor, id, getEsinettiClient(), { itemIds });
  } catch (err) {
    handle(err, back);
  }
  done(`${back}?lahetetty=${result.sent}&epaonnistui=${result.failed.length}#seuranta`);
}

export async function cancelBatchAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  try {
    await cancelBatch(ctx.run, actor, id, getEsinettiClient());
  } catch (err) {
    handle(err, back);
  }
  done(back);
}

export async function renewBatchAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx, actor } = await writer(back);
  let next: string;
  try {
    next = await renewBatch(ctx.run, actor, id);
  } catch (err) {
    handle(err, back);
  }
  done(`/sopimukset/erat/${next}?uusittu=1`);
}

export async function simulateContractSigningAction(formData: FormData) {
  const id = batchId(formData);
  const back = `/sopimukset/erat/${id}`;
  const { ctx } = await writer(back);
  if (!canSimulateSigning()) fail(back, "Simulointi ei ole käytössä.");
  const roundId = uuid.safeParse(formData.get("round_id"));
  if (!roundId.success) fail(back, "Kierrosta ei löytynyt.");
  await simulateSigning(ctx.db, roundId.data, ctx.user.sub);
  done(`${back}#seuranta`);
}
