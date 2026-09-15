import type { Sql } from "../db/types";
import { audit } from "../audit";
import { isStaffConnectionSub } from "../auth/login-params";
import { INVITE_TTL_DAYS, inviteUrl, normalizeEmail } from "../invitations/rules";
import { randomToken, sha256Hex } from "../security/crypto";

/**
 * Tuotantokannan ensimmäinen organisaatio ja pääkäyttäjä.
 *
 * ===========================================================================
 * MIKSI KUTSU EIKÄ VALMIS KÄYTTÄJÄRIVI
 *
 * `er_users.auth_sub` on Auth0:n tunniste, joka syntyy vasta ensimmäisellä
 * kirjautumisella, ja `getCurrentUser` luo rivin sen perusteella. Etukäteen
 * luotu rivi keksityllä tunnisteella estäisi oikean rivin syntymisen
 * (sähköposti on uniikki) eikä koskaan kytkeytyisi.
 *
 * Siksi pääkäyttäjä luodaan samalla mekanismilla kuin muutkin: henkilökunnan
 * kutsu roolilla `owner`. Kirjautuminen luo er_users-rivin, ja kutsun
 * hyväksyntä (`acceptInvitation`) tarkistaa Auth0:n vahvistetun sähköpostin ja
 * lisää jäsenyyden. Jos käyttäjä on jo kirjautunut kerran, jäsenyys lisätään
 * suoraan hänen olemassa olevaan riviinsä.
 *
 * Ajetaan palvelun roolilla yhdessä transaktiossa. Ei `server-only`-merkintää:
 * kutsuja on tsx-skripti (`scripts/deploy/bootstrap-owner.mts`).
 * ===========================================================================
 */

export const BOOTSTRAP_ORGANIZATION = { name: "Adepta Oy", businessId: "2237131-2" } as const;

export type BootstrapOwnerStatus =
  | { status: "already_owner" }
  | { status: "member_added"; userId: string }
  | { status: "other_role"; role: string }
  | { status: "not_staff_login" }
  | { status: "invited"; invitationId: string; token: string; url: string };

export interface BootstrapResult {
  organizationId: string;
  organizationCreated: boolean;
  owner: BootstrapOwnerStatus;
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function bootstrapOwner(
  tx: Sql,
  opts: { email: string; baseUrl: string; organization?: { name: string; businessId: string } },
): Promise<BootstrapResult> {
  if (!isPlausibleEmail(opts.email)) throw new Error("Sähköpostiosoite on virheellinen.");
  const email = normalizeEmail(opts.email);
  const org = opts.organization ?? BOOTSTRAP_ORGANIZATION;

  let [row] = await tx.query<{ id: string }>("select id from er_organizations where business_id = $1", [org.businessId]);
  const organizationCreated = !row;
  if (!row) {
    [row] = await tx.query<{ id: string }>("insert into er_organizations (name, business_id) values ($1, $2) returning id", [org.name, org.businessId]);
    await audit(tx, { organizationId: row.id, userId: null, action: "bootstrap", entity: "organization", entityId: row.id });
  }
  const organizationId = row.id;

  const [user] = await tx.query<{ id: string; auth_sub: string; role: string | null }>(
    `select u.id, u.auth_sub, m.role from er_users u
       left join er_org_members m on m.user_id = u.id and m.organization_id = $1
      where lower(u.email) = $2`,
    [organizationId, email],
  );

  if (user?.role === "owner") return { organizationId, organizationCreated, owner: { status: "already_owner" } };
  // Olemassa olevaa roolia ei muuteta skriptillä: se on pääkäyttäjän päätös sovelluksessa.
  if (user?.role) return { organizationId, organizationCreated, owner: { status: "other_role", role: user.role } };

  // Sähköpostikoodilla syntynyt tunnus ei saa pääkäyttäjän roolia: MFA vaaditaan vain salasanakirjautumiselta.
  if (user && !isStaffConnectionSub(user.auth_sub)) return { organizationId, organizationCreated, owner: { status: "not_staff_login" } };

  if (user) {
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1, $2, 'owner')", [organizationId, user.id]);
    await audit(tx, { organizationId, userId: null, action: "bootstrap", entity: "org_member", entityId: user.id, details: { role: "owner" } });
    return { organizationId, organizationCreated, owner: { status: "member_added", userId: user.id } };
  }

  // Samalle osoitteelle jää voimaan vain uusin kutsu, kuten sovelluksessa.
  await tx.query(
    `update er_invitations set revoked_at = now()
      where organization_id = $1 and kind = 'staff' and lower(email) = $2 and accepted_at is null and revoked_at is null`,
    [organizationId, email],
  );
  const token = randomToken();
  const [inv] = await tx.query<{ id: string }>(
    `insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at)
     values ($1, $2, 'staff', 'owner', $3, now() + make_interval(days => $4::int)) returning id`,
    [organizationId, email, sha256Hex(token), INVITE_TTL_DAYS],
  );
  await audit(tx, { organizationId, userId: null, action: "bootstrap", entity: "invitation", entityId: inv.id, details: { kind: "staff", role: "owner" } });

  return { organizationId, organizationCreated, owner: { status: "invited", invitationId: inv.id, token, url: inviteUrl(token, opts.baseUrl) } };
}
