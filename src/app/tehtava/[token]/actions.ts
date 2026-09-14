"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { fail } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import { resolveProviderTask, type ProviderTask } from "@/lib/service-requests/links";
import { addComment, changeStatus, RequestError, updateCost } from "@/lib/service-requests/mutations";
import { photoFiles, savePhotos } from "@/lib/service-requests/photos";
import { optEur } from "@/lib/service-requests/schemas";
import { providerTransition } from "@/lib/service-requests/status";
import type { Sql } from "@/lib/db";

/**
 * Palveluntuottajan toiminnot tehtävälinkistä. Ei kirjautumista: jokainen
 * kutsu ratkaisee linkin uudelleen palvelun roolilla, ja muutokset rajataan
 * linkin pyyntöön. Tapahtumat kirjataan provider_actor = true.
 */

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const PROVIDER = { userId: null, providerActor: true } as const;

function tokenFrom(formData: FormData): string {
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) notFound();
  return token;
}

async function withTask(token: string, fn: (tx: Sql, task: ProviderTask) => Promise<void>) {
  const back = `/tehtava/${token}`;
  const db = await getDb();
  await guarded(back, () =>
    db.asService(async (tx) => {
      const task = await resolveProviderTask(tx, token);
      if (!task) throw new RequestError("Linkki ei ole enää voimassa. Pyydä isännöinniltä uusi tilaus.");
      await fn(tx, task);
    }),
  );
  redirect(back);
}

export async function providerStatus(formData: FormData) {
  const token = tokenFrom(formData);
  const action = z.enum(["acknowledge", "start", "complete"]).safeParse(formData.get("action"));
  if (!action.success) fail(`/tehtava/${token}`, "Tuntematon toiminto.");
  await withTask(token, async (tx, task) => {
    const next = providerTransition(task.status, action.data);
    if (!next) throw new RequestError("Toimintoa ei voi tehdä tehtävän nykyisessä tilassa.");
    if (action.data === "acknowledge") {
      await tx.query("update er_service_requests set provider_acknowledged_at = coalesce(provider_acknowledged_at, now()) where id = $1", [task.requestId]);
      await addComment(tx, { requestId: task.requestId, body: "Tilaus vastaanotettu.", visibility: "provider", actor: PROVIDER });
    } else {
      if (action.data === "start") {
        await tx.query("update er_service_requests set provider_acknowledged_at = coalesce(provider_acknowledged_at, now()) where id = $1", [task.requestId]);
      }
      await changeStatus(tx, { requestId: task.requestId, to: next, actor: PROVIDER, mode: "provider" });
    }
    await audit(tx, { organizationId: task.organizationId, userId: null, action: `provider_${action.data}`, entity: "service_request", entityId: task.requestId, details: { link_id: task.linkId } });
  });
}

export async function providerComment(formData: FormData) {
  const token = tokenFrom(formData);
  const body = z.string().trim().min(1).max(5000).safeParse(formData.get("body"));
  if (!body.success) fail(`/tehtava/${token}`, "Kirjoita kommentti.");
  await withTask(token, async (tx, task) => {
    await addComment(tx, { requestId: task.requestId, body: body.data, visibility: "provider", actor: PROVIDER });
  });
}

export async function providerCost(formData: FormData) {
  const token = tokenFrom(formData);
  const cost = optEur.safeParse(formData.get("cost_eur"));
  if (!cost.success || cost.data === null) fail(`/tehtava/${token}`, "Anna kustannus euroina.");
  await withTask(token, async (tx, task) => {
    if (["closed", "rejected"].includes(task.status)) throw new RequestError("Suljettuun tehtävään ei voi kirjata kustannusta.");
    const [current] = await tx.query<{ cost_responsibility: "company" | "shareholder" | "unclear" }>(
      "select cost_responsibility from er_service_requests where id = $1 and organization_id = $2",
      [task.requestId, task.organizationId],
    );
    await updateCost(tx, { requestId: task.requestId, responsibility: current.cost_responsibility, costEur: cost.data, actor: PROVIDER, visibility: "provider" });
    await audit(tx, { organizationId: task.organizationId, userId: null, action: "provider_cost", entity: "service_request", entityId: task.requestId, details: { link_id: task.linkId } });
  });
}

export async function providerPhotos(formData: FormData) {
  const token = tokenFrom(formData);
  const photos = photoFiles(formData);
  if (photos.length === 0) fail(`/tehtava/${token}`, "Valitse vähintään yksi kuva.");
  await withTask(token, async (tx, task) => {
    await savePhotos(tx, photos, { organizationId: task.organizationId, companyId: task.companyId, requestId: task.requestId, visibility: "reporter", userId: null, providerActor: true });
  });
}
