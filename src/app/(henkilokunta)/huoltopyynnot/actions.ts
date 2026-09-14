"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail, parseForm } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import {
  addComment, changeStatus, createRequest, orderFromProvider, RequestError, updateAssignment, updateCost,
} from "@/lib/service-requests/mutations";
import { photoFiles, savePhotos } from "@/lib/service-requests/photos";
import { defaultProviderId } from "@/lib/service-requests/queries";
import { assignmentSchema, commentSchema, costSchema, staffRequestSchema, statusSchema, uuid } from "@/lib/service-requests/schemas";
import { REOPEN_STATUS } from "@/lib/service-requests/status";

const WRITERS = ["owner", "manager", "assistant"] as const;

async function staff(back: string, roles: readonly ("owner" | "manager" | "assistant" | "accountant")[] = WRITERS) {
  const ctx = await requireStaff();
  if (!ctx.can(...roles)) fail(back, "Roolillasi ei voi tehdä tätä muutosta.");
  return ctx;
}

function requestPath(id: string) {
  return `/huoltopyynnot/${id}`;
}

function refresh(id: string, companyId?: string) {
  revalidatePath(requestPath(id));
  revalidatePath("/huoltopyynnot");
  if (companyId) revalidatePath(`/taloyhtiot/${companyId}/huolto`);
}

export async function createStaffRequest(formData: FormData) {
  const back = "/huoltopyynnot/uusi";
  const ctx = await staff(back);
  const d = parseForm(staffRequestSchema, formData, back);
  const photos = photoFiles(formData);
  const photoVisibility = formData.get("photo_visibility") === "internal" ? "internal" : "reporter";

  const created = await guarded(back, () =>
    ctx.run(async (tx) => {
      const providerId = await defaultProviderId(tx, d.company_id);
      const r = await createRequest(tx, {
        companyId: d.company_id, shareGroupId: d.share_group_id, unitText: d.share_group_id ? null : d.unit_text,
        title: d.title, description: d.description, category: d.category, urgency: d.urgency,
        mayUseMasterKey: d.may_use_master_key, hasPets: d.has_pets, source: "staff", reporterUserId: null,
        reporterName: d.reporter_name, reporterPhone: d.reporter_phone, reporterEmail: d.reporter_email,
        assigneeUserId: d.assignee_user_id, providerId, dueOn: d.due_on,
      });
      await savePhotos(tx, photos, { organizationId: r.organizationId, companyId: d.company_id, requestId: r.id, visibility: photoVisibility, userId: ctx.user.id });
      await audit(tx, { organizationId: r.organizationId, userId: ctx.user.id, action: "create", entity: "service_request", entityId: r.id });
      return r;
    }),
  );
  refresh(created.id, d.company_id);
  redirect(requestPath(created.id));
}

export async function updateRequestStatus(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back);
  const d = parseForm(statusSchema, formData, back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const res = await changeStatus(tx, { requestId: id, to: d.status, actor: { userId: ctx.user.id }, mode: "staff", comment: d.comment, commentVisibility: d.visibility });
      if (res.changed) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "status", entity: "service_request", entityId: id, details: { status: d.status } });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function reopenRequest(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back);
  const comment = z.string().trim().min(3, "Kirjoita syy uudelleenavaukselle.").max(5000).safeParse(formData.get("comment"));
  if (!comment.success) fail(back, "Kirjoita syy uudelleenavaukselle.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await changeStatus(tx, { requestId: id, to: REOPEN_STATUS, actor: { userId: ctx.user.id }, mode: "staff", comment: comment.data, commentVisibility: "reporter" });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "reopen", entity: "service_request", entityId: id });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function updateRequestAssignment(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back);
  const d = parseForm(assignmentSchema, formData, back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await updateAssignment(tx, {
        requestId: id, assigneeUserId: d.assignee_user_id, providerId: d.provider_id, dueOn: d.due_on, urgency: d.urgency,
        category: d.category, shareGroupId: d.share_group_id, actor: { userId: ctx.user.id },
      });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function updateRequestCost(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back, [...WRITERS, "accountant"]);
  const d = parseForm(costSchema, formData, back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await updateCost(tx, { requestId: id, responsibility: d.cost_responsibility, costEur: d.cost_eur, actor: { userId: ctx.user.id } });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "cost", entity: "service_request", entityId: id });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function addRequestComment(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back, [...WRITERS, "accountant"]);
  const d = parseForm(commentSchema, formData, back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const [r] = await tx.query<{ id: string }>("select id from er_service_requests where id = $1", [id]);
      if (!r) throw new RequestError("Huoltopyyntöä ei löytynyt.");
      await addComment(tx, { requestId: id, body: d.body, visibility: d.visibility, actor: { userId: ctx.user.id } });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function addRequestPhotos(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back, [...WRITERS, "accountant"]);
  const photos = photoFiles(formData);
  if (photos.length === 0) fail(back, "Valitse vähintään yksi kuva.");
  const visibility = formData.get("photo_visibility") === "internal" ? "internal" : "reporter";
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const [r] = await tx.query<{ organization_id: string; company_id: string }>("select organization_id, company_id from er_service_requests where id = $1", [id]);
      if (!r) throw new RequestError("Huoltopyyntöä ei löytynyt.");
      await savePhotos(tx, photos, { organizationId: r.organization_id, companyId: r.company_id, requestId: id, visibility, userId: ctx.user.id });
    }),
  );
  refresh(id);
  redirect(back);
}

export async function orderRequest(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = requestPath(id);
  const ctx = await staff(back);
  await guarded(back, () => ctx.run((tx) => orderFromProvider(tx, { requestId: id, actor: { userId: ctx.user.id } })));
  refresh(id);
  redirect(`${back}?tilattu=1`);
}
