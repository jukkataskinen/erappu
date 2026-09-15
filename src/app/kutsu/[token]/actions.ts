"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE, getCurrentUser } from "@/lib/auth/current-user";
import { isStaffConnectionSub } from "@/lib/auth/login-params";
import { authMode } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { acceptInvitation, isInviteTokenShaped, previewInvitation } from "@/lib/invitations";
import { signValue } from "@/lib/security/crypto";

/**
 * Kutsun hyväksyntä. Token tulee lomakkeen piilokentästä, ei koskaan
 * virheparametriin. Virhekoodit ovat kiinteitä, jotta osoiteriville ei
 * päädy kutsun tai käyttäjän tietoja.
 */
export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!isInviteTokenShaped(token)) redirect("/");
  const back = `/kutsu/${token}`;

  const user = await getCurrentUser();
  if (!user) redirect(back);

  // Auth0:ssa käytetään istunnon vahvistettua sähköpostia; vahvistamaton
  // osoite ei kelpaa, koska sillä voisi ottaa toisen osoitteen kutsun.
  // Kehityskirjautumisessa sähköposti on er_users.email.
  let email: string | null = user.email;
  const db = await getDb();
  if (authMode() === "auth0") {
    const { auth0 } = await import("@/lib/auth/auth0");
    const session = await auth0.getSession();
    const verified = session?.user?.email_verified === true;
    email = verified && typeof session?.user?.email === "string" ? session.user.email : null;

    // Henkilökunnan kutsu vain salasana+MFA-kirjautumisella, ei sähköpostikoodilla.
    const preview = await db.asService((tx) => previewInvitation(tx, token));
    if (preview?.kind === "staff" && !isStaffConnectionSub(user.sub)) redirect(`${back}?virhe=henkilokunta`);
  }

  const result = await db.asService((tx) => acceptInvitation(tx, token, { id: user.id, email }));
  if (!result.ok) redirect(`${back}?virhe=${result.reason === "invalid" ? "voimassa" : "tunnus"}`);

  if (result.kind === "staff") {
    (await cookies()).set(ACTIVE_ORG_COOKIE, signValue(result.organizationId), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90,
    });
    redirect("/tyopoyta");
  }
  redirect("/portaali/oma");
}
