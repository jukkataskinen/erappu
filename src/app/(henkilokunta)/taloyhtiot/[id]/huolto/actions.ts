"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import { rotatePublicFormLink } from "@/lib/service-requests/links";
import { uuid } from "@/lib/service-requests/schemas";

/** Luo tai vaihtaa yhtiön julkisen huoltopyyntölomakkeen linkin (QR). */
export async function rotatePublicForm(formData: FormData) {
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/huolto`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi hallita lomakelinkkiä.");
  await guarded(back, () =>
    ctx.run(async (tx) => {
      await rotatePublicFormLink(tx, { companyId, userId: ctx.user.id });
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "rotate", entity: "public_request_form", entityId: companyId });
    }),
  );
  revalidatePath(back);
  redirect(back);
}
