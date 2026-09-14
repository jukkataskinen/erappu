import type { Sql } from "@/lib/db";
import type { OrgRole } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";

/**
 * Organisaation jäsenet ja kutsut. Kaikki kyselyt käyttäjän
 * RLS-transaktiossa: jäseniä muokkaa vain pääkäyttäjä (members_owner_write),
 * kutsuja näkee vain owner/manager (invitations_staff).
 */

export interface MemberRow {
  user_id: string;
  email: string;
  full_name: string | null;
  role: OrgRole;
  created_at: string;
}

export async function listMembers(tx: Sql, organizationId: string): Promise<MemberRow[]> {
  return tx.query<MemberRow>(
    `select m.user_id, u.email, u.full_name, m.role, m.created_at
       from er_org_members m join er_users u on u.id = m.user_id
      where m.organization_id = $1
      order by case m.role when 'owner' then 0 when 'manager' then 1 when 'accountant' then 2 else 3 end, u.full_name nulls last, u.email`,
    [organizationId],
  );
}

export interface OpenInvitationRow {
  id: string;
  email: string;
  kind: "staff" | "portal";
  role: string;
  expires_at: string;
  last_sent_at: string;
  created_at: string;
  party_name: string | null;
  company_name: string | null;
  expired: boolean;
}

export async function listOpenInvitations(tx: Sql, organizationId: string, kind: "staff" | "portal"): Promise<OpenInvitationRow[]> {
  return tx.query<OpenInvitationRow>(
    `select i.id, i.email, i.kind, i.role, i.expires_at, i.last_sent_at, i.created_at,
            p.display_name as party_name, c.name as company_name, (i.expires_at <= now()) as expired
       from er_invitations i
       left join er_parties p on p.id = i.party_id
       left join er_housing_companies c on c.id = i.company_id
      where i.organization_id = $1 and i.kind = $2 and i.accepted_at is null and i.revoked_at is null
      order by i.created_at desc`,
    [organizationId, kind],
  );
}

export type MemberChangeResult = "ok" | "not_found" | "last_owner" | "forbidden";

async function otherOwnerExists(tx: Sql, organizationId: string, userId: string): Promise<boolean> {
  const rows = await tx.query(
    "select 1 from er_org_members where organization_id = $1 and role = 'owner' and user_id <> $2",
    [organizationId, userId],
  );
  return rows.length > 0;
}

/**
 * Roolin vaihto. Viimeistä pääkäyttäjää ei voi alentaa (tarkistus tässä ja
 * triggerissä er_protect_last_owner, joka kattaa myös suorat kyselyt).
 */
export async function changeMemberRole(
  tx: Sql,
  opts: { organizationId: string; actorId: string; actorRole: OrgRole; userId: string; role: OrgRole },
): Promise<MemberChangeResult> {
  if (opts.actorRole !== "owner") return "forbidden";
  const [current] = await tx.query<{ role: OrgRole }>(
    "select role from er_org_members where organization_id = $1 and user_id = $2",
    [opts.organizationId, opts.userId],
  );
  if (!current) return "not_found";
  if (current.role === opts.role) return "ok";
  if (current.role === "owner" && !(await otherOwnerExists(tx, opts.organizationId, opts.userId))) return "last_owner";
  const rows = await tx.query(
    "update er_org_members set role = $3 where organization_id = $1 and user_id = $2 returning user_id",
    [opts.organizationId, opts.userId, opts.role],
  );
  if (rows.length === 0) return "forbidden";
  await audit(tx, { organizationId: opts.organizationId, userId: opts.actorId, action: "change_role", entity: "org_member", entityId: opts.userId, details: { from: current.role, to: opts.role } });
  return "ok";
}

export async function removeMember(
  tx: Sql,
  opts: { organizationId: string; actorId: string; actorRole: OrgRole; userId: string },
): Promise<MemberChangeResult> {
  if (opts.actorRole !== "owner") return "forbidden";
  const [current] = await tx.query<{ role: OrgRole }>(
    "select role from er_org_members where organization_id = $1 and user_id = $2",
    [opts.organizationId, opts.userId],
  );
  if (!current) return "not_found";
  if (current.role === "owner" && !(await otherOwnerExists(tx, opts.organizationId, opts.userId))) return "last_owner";
  const rows = await tx.query("delete from er_org_members where organization_id = $1 and user_id = $2 returning user_id", [
    opts.organizationId,
    opts.userId,
  ]);
  if (rows.length === 0) return "forbidden";
  await audit(tx, { organizationId: opts.organizationId, userId: opts.actorId, action: "remove", entity: "org_member", entityId: opts.userId, details: { role: current.role } });
  return "ok";
}

export function isLastOwnerError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("er_last_owner");
}
