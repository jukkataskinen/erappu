"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { createStaffInvitation, resendInvitation, revokeInvitation } from "@/lib/invitations";
import { changeMemberRole, isLastOwnerError, removeMember, type MemberChangeResult } from "@/lib/settings/members";
import { organizationSchema, updateOrganization } from "@/lib/settings/organization";

const uuid = z.string().uuid();
const role = z.enum(["owner", "manager", "accountant", "assistant"]);
const BACKS = ["/asetukset", "/asetukset/portaali"] as const;

function backFrom(formData: FormData): (typeof BACKS)[number] {
  const v = formData.get("back");
  return BACKS.find((b) => b === v) ?? "/asetukset";
}

export async function inviteStaff(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const data = parseForm(
    z.object({ email: z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200), role }),
    formData,
    "/asetukset",
  );
  const res = await ctx.run((tx) =>
    createStaffInvitation(tx, { organizationId: ctx.org.organizationId, inviterId: ctx.user.id, inviterRole: ctx.org.role, email: data.email, role: data.role }),
  );
  if (res.status === "forbidden_role") fail("/asetukset", "Pääkäyttäjäksi voi kutsua vain pääkäyttäjä.");
  if (res.status === "already_member") fail("/asetukset", "Käyttäjä on jo organisaation jäsen.");
  revalidatePath("/asetukset");
  redirect("/asetukset?ok=kutsu");
}

export async function resendInvite(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const back = backFrom(formData);
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) fail(back, "Kutsua ei löytynyt.");
  const res = await ctx.run((tx) =>
    resendInvitation(tx, { organizationId: ctx.org.organizationId, invitationId: id.data, actorId: ctx.user.id, actorRole: ctx.org.role }),
  );
  if (res.status === "not_found") fail(back, "Kutsua ei löytynyt tai se on jo käytetty.");
  if (res.status === "forbidden_role") fail(back, "Pääkäyttäjäkutsun voi lähettää uudelleen vain pääkäyttäjä.");
  revalidatePath(back);
  redirect(`${back}?ok=uudelleen`);
}

export async function revokeInvite(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const back = backFrom(formData);
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) fail(back, "Kutsua ei löytynyt.");
  const ok = await ctx.run((tx) => revokeInvitation(tx, { organizationId: ctx.org.organizationId, invitationId: id.data, actorId: ctx.user.id }));
  if (!ok) fail(back, "Kutsua ei löytynyt tai se on jo käytetty.");
  revalidatePath(back);
  redirect(`${back}?ok=peruttu`);
}

function memberError(res: MemberChangeResult): string | null {
  if (res === "last_owner") return "Organisaatiossa on oltava vähintään yksi pääkäyttäjä.";
  if (res === "forbidden") return "Vain pääkäyttäjä voi muuttaa jäseniä.";
  if (res === "not_found") return "Käyttäjää ei löytynyt.";
  return null;
}

async function runMemberChange(fn: () => Promise<MemberChangeResult>): Promise<MemberChangeResult> {
  try {
    return await fn();
  } catch (err) {
    // Trigger er_protect_last_owner on viimeinen suoja rinnakkaisille muutoksille.
    if (isLastOwnerError(err)) return "last_owner";
    throw err;
  }
}

export async function changeRole(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const data = parseForm(z.object({ user_id: uuid, role }), formData, "/asetukset");
  const res = await runMemberChange(() =>
    ctx.run((tx) => changeMemberRole(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, actorRole: ctx.org.role, userId: data.user_id, role: data.role })),
  );
  const err = memberError(res);
  if (err) fail("/asetukset", err);
  revalidatePath("/asetukset");
  redirect("/asetukset?ok=rooli");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const data = parseForm(z.object({ user_id: uuid }), formData, "/asetukset");
  const res = await runMemberChange(() =>
    ctx.run((tx) => removeMember(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, actorRole: ctx.org.role, userId: data.user_id })),
  );
  const err = memberError(res);
  if (err) fail("/asetukset", err);
  revalidatePath("/asetukset");
  // Oman jäsenyyden poiston jälkeen asetussivu ei enää ole käytettävissä.
  redirect(data.user_id === ctx.user.id ? "/" : "/asetukset?ok=poistettu");
}

export async function saveOrganization(formData: FormData) {
  const ctx = await requireSettingsAccess();
  const back = "/asetukset/organisaatio";
  if (!ctx.can("owner")) fail(back, "Organisaation tietoja voi muuttaa vain pääkäyttäjä.");
  const data = parseForm(organizationSchema, formData, back);
  let ok = false;
  try {
    ok = await ctx.run((tx) => updateOrganization(tx, ctx.org.organizationId, ctx.user.id, data));
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Y-tunnus on jo toisen organisaation käytössä.");
    throw err;
  }
  if (!ok) fail(back, "Organisaation tietoja voi muuttaa vain pääkäyttäjä.");
  revalidatePath(back);
  redirect(`${back}?ok=tallennettu`);
}
