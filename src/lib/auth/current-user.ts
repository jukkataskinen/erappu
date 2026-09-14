import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Database, type Sql } from "@/lib/db";
import { getSessionIdentity } from "./session";
import { signValue, verifySignedValue } from "@/lib/security/crypto";

export type OrgRole = "owner" | "manager" | "accountant" | "assistant";
export type PortalRole = "board" | "owner" | "resident" | "provider";

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

export interface PortalGrant {
  companyId: string;
  companyName: string;
  role: PortalRole;
  shareGroupId: string | null;
  unitLabel: string | null;
  providerId: string | null;
}

export interface CurrentUser {
  id: string;
  sub: string;
  email: string;
  fullName: string | null;
  memberships: Membership[];
  portal: PortalGrant[];
}

export const ACTIVE_ORG_COOKIE = "erappu_org";

/**
 * Kirjautunut käyttäjä, hänen organisaatioroolinsa ja portaalioikeutensa.
 * Luetaan palvelun roolilla, koska käyttäjärivi pitää löytää ennen kuin
 * RLS-funktiot voivat tunnistaa hänet. Välimuisti pyynnön ajaksi.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const db = await getDb();

  return db.asService(async (tx) => {
    let [user] = await tx.query<{ id: string; email: string; full_name: string | null }>(
      "select id, email, full_name from er_users where auth_sub = $1",
      [identity.sub],
    );
    if (!user && identity.email) {
      [user] = await tx.query(
        "insert into er_users (auth_sub, email) values ($1, $2) on conflict (auth_sub) do update set email = excluded.email returning id, email, full_name",
        [identity.sub, identity.email],
      );
    }
    if (!user) return null;

    const memberships = await tx.query<{ organization_id: string; name: string; role: OrgRole }>(
      `select m.organization_id, o.name, m.role from er_org_members m
         join er_organizations o on o.id = m.organization_id
        where m.user_id = $1 order by o.name`,
      [user.id],
    );
    const portal = await tx.query<{
      company_id: string; name: string; role: PortalRole; share_group_id: string | null; unit_label: string | null; provider_id: string | null;
    }>(
      `select p.company_id, c.name, p.role, p.share_group_id, g.unit_label, p.provider_id
         from er_portal_access p
         join er_housing_companies c on c.id = p.company_id
         left join er_share_groups g on g.id = p.share_group_id
        where p.user_id = $1 and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)
        order by c.name, g.unit_label`,
      [user.id],
    );

    return {
      id: user.id,
      sub: identity.sub,
      email: user.email,
      fullName: user.full_name,
      memberships: memberships.map((m) => ({ organizationId: m.organization_id, organizationName: m.name, role: m.role })),
      portal: portal.map((p) => ({
        companyId: p.company_id, companyName: p.name, role: p.role,
        shareGroupId: p.share_group_id, unitLabel: p.unit_label, providerId: p.provider_id,
      })),
    };
  });
});

export interface StaffContext {
  db: Database;
  user: CurrentUser;
  org: Membership;
  /** Käyttäjän RLS-transaktio. */
  run<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  can(...roles: OrgRole[]): boolean;
}

/** Vaatii henkilökunnan jäsenyyden. Valittu organisaatio evästeestä. */
export const requireStaff = cache(async (): Promise<StaffContext> => {
  const user = await getCurrentUser();
  if (!user) redirect("/kirjaudu");
  if (user.memberships.length === 0) redirect(user.portal.length > 0 ? "/portaali" : "/ei-oikeutta");

  const selected = verifySignedValue((await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
  const org = user.memberships.find((m) => m.organizationId === selected) ?? user.memberships[0];
  const db = await getDb();
  return {
    db,
    user,
    org,
    run: (fn) => db.asUser(user.sub, fn),
    can: (...roles) => roles.includes(org.role),
  };
});

export interface PortalContext {
  db: Database;
  user: CurrentUser;
  run<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  companies: { id: string; name: string; roles: PortalRole[] }[];
}

export const requirePortal = cache(async (): Promise<PortalContext> => {
  const user = await getCurrentUser();
  if (!user) redirect("/kirjaudu");
  if (user.portal.length === 0) redirect(user.memberships.length > 0 ? "/tyopoyta" : "/ei-oikeutta");
  const db = await getDb();
  const map = new Map<string, { id: string; name: string; roles: PortalRole[] }>();
  for (const g of user.portal) {
    const c = map.get(g.companyId) ?? { id: g.companyId, name: g.companyName, roles: [] };
    if (!c.roles.includes(g.role)) c.roles.push(g.role);
    map.set(g.companyId, c);
  }
  return { db, user, run: (fn) => db.asUser(user.sub, fn), companies: [...map.values()] };
});

export function signedOrgCookie(orgId: string): string {
  return signValue(orgId);
}
