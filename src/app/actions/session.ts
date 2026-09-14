"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_ORG_COOKIE, getCurrentUser } from "@/lib/auth/current-user";
import { DEV_SESSION_COOKIE, devLoginAllowed } from "@/lib/auth/session";
import { signValue } from "@/lib/security/crypto";
import { getDb } from "@/lib/db";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function devLogin(formData: FormData) {
  if (!devLoginAllowed()) redirect("/kirjaudu");
  const userId = z.string().uuid().parse(formData.get("userId"));
  const db = await getDb();
  const [user] = await db.asService((tx) => tx.query<{ auth_sub: string }>("select auth_sub from er_users where id = $1", [userId]));
  if (!user) redirect("/kirjaudu");
  (await cookies()).set(DEV_SESSION_COOKIE, signValue(user.auth_sub), { ...cookieOpts, maxAge: 60 * 60 * 12 });
  redirect("/");
}

export async function switchOrganization(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/kirjaudu");
  const orgId = z.string().uuid().parse(formData.get("organizationId"));
  // Evästeeseen hyväksytään vain organisaatio, jossa käyttäjä on jäsen.
  if (!user.memberships.some((m) => m.organizationId === orgId)) redirect("/tyopoyta");
  (await cookies()).set(ACTIVE_ORG_COOKIE, signValue(orgId), { ...cookieOpts, maxAge: 60 * 60 * 24 * 90 });
  redirect("/tyopoyta");
}
