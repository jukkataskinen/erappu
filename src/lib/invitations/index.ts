import "server-only";
import type { Sql } from "@/lib/db";
import type { OrgRole } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { queueMessage } from "@/lib/messaging";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import {
  INVITE_TTL_DAYS,
  PORTAL_INVITE_ROLE_LABEL,
  STAFF_ROLE_LABEL,
  assignableStaffRoles,
  emailsMatch,
  inviteUrl,
  isInviteTokenShaped,
  normalizeEmail,
  type PortalInviteRole,
} from "./rules";

export * from "./rules";

/*
 * ===========================================================================
 * TIETOTURVAKATSELMUS (CLAUDE.md 0.1)
 *
 * 1. Kuka saa kutsua: luonti, peruminen ja uudelleenlähetys ajetaan käyttäjän
 *    RLS-transaktiossa (er_invitations: owner/manager; pääkäyttäjäkutsu vain
 *    owner, rajoittava politiikka 0070). Hyväksyntä ajetaan palvelun roolilla,
 *    koska hyväksyjä ei vielä kuulu organisaatioon.
 * 2. Henkilötieto: kutsun sähköposti on vain kutsurivillä ja viestijonossa.
 *    Julkinen kutsusivu näyttää vain organisaation ja yhtiön nimen. Lokiin
 *    (details) ei kirjoiteta sähköpostia.
 * 3. Syöte: token tarkistetaan muodoltaan ennen kyselyä, lomakkeet zodilla.
 * 4. Arvaus ja toisto: 256 bitin token, kantaan vain sha256-tiiviste,
 *    vanheneminen 14 pv, kertakäyttöinen (accepted_at) ja peruttava
 *    (revoked_at). Linkki yksin ei riitä: kirjautuneen sähköpostin on
 *    vastattava kutsua, joten jonoon jäänyt viestirunko ei avaa oikeuksia.
 * 6. Epäonnistuminen: tuntematon, vanhentunut, käytetty ja peruttu kutsu
 *    antavat saman vastauksen. Väärä sähköposti kerrotaan paljastamatta
 *    kutsun osoitetta.
 * 7. Loki: luonti, uudelleenlähetys, peruminen ja hyväksyntä audit-lokiin.
 * ===========================================================================
 */

export type InviteKind = "staff" | "portal";

async function orgName(tx: Sql, organizationId: string): Promise<string> {
  const [o] = await tx.query<{ name: string }>("select name from er_organizations where id = $1", [organizationId]);
  return o?.name ?? "eRappu";
}

function staffMessage(org: string, role: OrgRole, url: string) {
  return {
    subject: `Kutsu eRappuun: ${org}`,
    body: [
      `Sinut on kutsuttu eRappuun organisaatioon ${org} roolilla ${STAFF_ROLE_LABEL[role].toLowerCase()}.`,
      "",
      `Hyväksy kutsu osoitteessa ${url}`,
      "",
      `Kutsu on voimassa ${INVITE_TTL_DAYS} päivää. Kirjaudu samalla sähköpostiosoitteella, johon tämä viesti tuli.`,
    ].join("\n"),
  };
}

function portalMessage(company: string, org: string, url: string) {
  return {
    subject: `Kutsu taloyhtiön portaaliin: ${company}`,
    body: [
      `Isännöintiyritys ${org} kutsuu sinut taloyhtiön ${company} asukas- ja osakasportaaliin.`,
      "Portaalissa näet huoneistosi tiedot, tiedotteet ja voit tehdä huoltopyynnön.",
      "",
      `Hyväksy kutsu osoitteessa ${url}`,
      "",
      `Kutsu on voimassa ${INVITE_TTL_DAYS} päivää. Kirjaudu samalla sähköpostiosoitteella, johon tämä viesti tuli.`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Henkilökuntakutsu
// ---------------------------------------------------------------------------

export type CreateStaffResult =
  | { status: "sent"; invitationId: string; token: string }
  | { status: "forbidden_role" }
  | { status: "already_member" };

/** Aja käyttäjän RLS-transaktiossa. */
export async function createStaffInvitation(
  tx: Sql,
  opts: { organizationId: string; inviterId: string; inviterRole: OrgRole; email: string; role: OrgRole },
): Promise<CreateStaffResult> {
  if (!assignableStaffRoles(opts.inviterRole).includes(opts.role)) return { status: "forbidden_role" };
  const email = normalizeEmail(opts.email);

  const member = await tx.query(
    `select 1 from er_org_members m join er_users u on u.id = m.user_id
      where m.organization_id = $1 and lower(u.email) = $2`,
    [opts.organizationId, email],
  );
  if (member.length) return { status: "already_member" };

  // Samalle osoitteelle jää voimaan vain uusin kutsu.
  await tx.query(
    `update er_invitations set revoked_at = now()
      where organization_id = $1 and kind = 'staff' and lower(email) = $2 and accepted_at is null and revoked_at is null`,
    [opts.organizationId, email],
  );

  const token = randomToken();
  const [row] = await tx.query<{ id: string }>(
    `insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at, created_by)
     values ($1, $2, 'staff', $3, $4, now() + make_interval(days => $5::int), $6) returning id`,
    [opts.organizationId, email, opts.role, sha256Hex(token), INVITE_TTL_DAYS, opts.inviterId],
  );
  const msg = staffMessage(await orgName(tx, opts.organizationId), opts.role, inviteUrl(token));
  await queueMessage(tx, { organizationId: opts.organizationId, recipient: email, ...msg, subjectTable: "er_invitations", subjectId: row.id });
  await audit(tx, { organizationId: opts.organizationId, userId: opts.inviterId, action: "create", entity: "invitation", entityId: row.id, details: { kind: "staff", role: opts.role } });
  return { status: "sent", invitationId: row.id, token };
}

// ---------------------------------------------------------------------------
// Portaalikutsu
// ---------------------------------------------------------------------------

export type CreatePortalResult =
  | { status: "sent"; invitationId: string; token: string }
  | { status: "not_found" }
  | { status: "no_email" }
  | { status: "already_in_portal" };

/**
 * Kutsuu rekisterin osapuolen portaaliin. Aja käyttäjän RLS-transaktiossa:
 * osapuoli ja yhtiö näkyvät vain oman organisaation henkilökunnalle.
 * Osapuolella on oltava voimassa oleva omistus, asuminen tai hallitusjäsenyys
 * kyseisessä yhtiössä, ettei kutsua voi lähettää kenelle tahansa rekisterissä.
 */
export async function createPortalInvitation(
  tx: Sql,
  opts: { partyId: string; companyId: string; role: PortalInviteRole; inviterId: string },
): Promise<CreatePortalResult> {
  const [party] = await tx.query<{ id: string; organization_id: string; email: string | null; user_id: string | null; company_name: string }>(
    `select p.id, p.organization_id, p.email, p.user_id, c.name as company_name
       from er_parties p
       join er_housing_companies c on c.id = $2 and c.organization_id = p.organization_id
      where p.id = $1
        and (exists (select 1 from er_ownerships o join er_share_groups g on g.id = o.share_group_id
                      where o.party_id = p.id and g.company_id = c.id and (o.ends_on is null or o.ends_on >= current_date))
          or exists (select 1 from er_residencies r join er_share_groups g on g.id = r.share_group_id
                      where r.party_id = p.id and g.company_id = c.id and (r.ends_on is null or r.ends_on >= current_date))
          or exists (select 1 from er_board_memberships b
                      where b.party_id = p.id and b.company_id = c.id and (b.ends_on is null or b.ends_on >= current_date)))`,
    [opts.partyId, opts.companyId],
  );
  if (!party) return { status: "not_found" };
  if (party.user_id) return { status: "already_in_portal" };
  if (!party.email || !party.email.includes("@")) return { status: "no_email" };
  const email = normalizeEmail(party.email);

  await tx.query(
    "update er_invitations set revoked_at = now() where party_id = $1 and accepted_at is null and revoked_at is null",
    [party.id],
  );
  const token = randomToken();
  const [row] = await tx.query<{ id: string }>(
    `insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at, created_by, party_id, company_id)
     values ($1, $2, 'portal', $3, $4, now() + make_interval(days => $5::int), $6, $7, $8) returning id`,
    [party.organization_id, email, opts.role, sha256Hex(token), INVITE_TTL_DAYS, opts.inviterId, party.id, opts.companyId],
  );
  const msg = portalMessage(party.company_name, await orgName(tx, party.organization_id), inviteUrl(token));
  await queueMessage(tx, { organizationId: party.organization_id, recipient: email, partyId: party.id, ...msg, subjectTable: "er_invitations", subjectId: row.id });
  await audit(tx, { organizationId: party.organization_id, userId: opts.inviterId, action: "create", entity: "invitation", entityId: row.id, details: { kind: "portal", role: opts.role, party_id: party.id } });
  return { status: "sent", invitationId: row.id, token };
}

// ---------------------------------------------------------------------------
// Uudelleenlähetys ja peruminen (käyttäjän RLS-transaktio)
// ---------------------------------------------------------------------------

export type ResendResult = { status: "sent"; token: string } | { status: "not_found" } | { status: "forbidden_role" };

/** Uusi token ja uusi voimassaoloaika. Vanha linkki lakkaa toimimasta heti. */
export async function resendInvitation(
  tx: Sql,
  opts: { organizationId: string; invitationId: string; actorId: string; actorRole: OrgRole },
): Promise<ResendResult> {
  const [inv] = await tx.query<{ id: string; kind: InviteKind; role: string; email: string; company_id: string | null; party_id: string | null }>(
    `select id, kind, role, email, company_id, party_id from er_invitations
      where id = $1 and organization_id = $2 and accepted_at is null and revoked_at is null`,
    [opts.invitationId, opts.organizationId],
  );
  if (!inv) return { status: "not_found" };
  if (inv.kind === "staff" && !assignableStaffRoles(opts.actorRole).includes(inv.role as OrgRole)) return { status: "forbidden_role" };

  const token = randomToken();
  await tx.query(
    `update er_invitations set token_hash = $2, expires_at = now() + make_interval(days => $3::int), last_sent_at = now() where id = $1`,
    [inv.id, sha256Hex(token), INVITE_TTL_DAYS],
  );
  const org = await orgName(tx, opts.organizationId);
  let msg: { subject: string; body: string };
  if (inv.kind === "staff") {
    msg = staffMessage(org, inv.role as OrgRole, inviteUrl(token));
  } else {
    const [c] = await tx.query<{ name: string }>("select name from er_housing_companies where id = $1", [inv.company_id]);
    msg = portalMessage(c?.name ?? "taloyhtiö", org, inviteUrl(token));
  }
  await queueMessage(tx, { organizationId: opts.organizationId, recipient: inv.email, partyId: inv.party_id, ...msg, subjectTable: "er_invitations", subjectId: inv.id });
  await audit(tx, { organizationId: opts.organizationId, userId: opts.actorId, action: "resend", entity: "invitation", entityId: inv.id, details: { kind: inv.kind } });
  return { status: "sent", token };
}

export async function revokeInvitation(tx: Sql, opts: { organizationId: string; invitationId: string; actorId: string }): Promise<boolean> {
  const rows = await tx.query(
    `update er_invitations set revoked_at = now()
      where id = $1 and organization_id = $2 and accepted_at is null and revoked_at is null returning id`,
    [opts.invitationId, opts.organizationId],
  );
  if (rows.length) await audit(tx, { organizationId: opts.organizationId, userId: opts.actorId, action: "revoke", entity: "invitation", entityId: opts.invitationId });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Julkinen kutsusivu ja hyväksyntä (palvelun rooli)
// ---------------------------------------------------------------------------

export interface InvitationPreview {
  kind: InviteKind;
  organizationName: string;
  companyName: string | null;
  roleLabel: string;
}

/**
 * Kutsusivun tiedot ilman henkilötietoja: organisaation ja portaalikutsussa
 * yhtiön nimi. Palauttaa null kaikille ei-voimassa oleville kutsuille.
 */
export async function previewInvitation(tx: Sql, token: string): Promise<InvitationPreview | null> {
  if (!isInviteTokenShaped(token)) return null;
  const [row] = await tx.query<{ kind: InviteKind; role: string; org_name: string; company_name: string | null }>(
    `select i.kind, i.role, o.name as org_name, c.name as company_name
       from er_invitations i
       join er_organizations o on o.id = i.organization_id
       left join er_housing_companies c on c.id = i.company_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
    [sha256Hex(token)],
  );
  if (!row) return null;
  return {
    kind: row.kind,
    organizationName: row.org_name,
    companyName: row.company_name,
    roleLabel: row.kind === "staff" ? STAFF_ROLE_LABEL[row.role as OrgRole] : PORTAL_INVITE_ROLE_LABEL[row.role as PortalInviteRole],
  };
}

export type AcceptResult =
  | { ok: true; kind: InviteKind; organizationId: string }
  | { ok: false; reason: "invalid" | "email_mismatch" | "party_taken" };

/**
 * Hyväksyy kutsun. Aja palvelun roolilla yhdessä transaktiossa: rivi
 * lukitaan (for update), joten samaa kutsua ei voi käyttää kahdesti
 * rinnakkain.
 *
 * `userEmail` on kirjautumisen sähköposti: Auth0:ssa vahvistettu osoite,
 * kehityskirjautumisessa er_users.email.
 */
export async function acceptInvitation(tx: Sql, token: string, user: { id: string; email: string | null }): Promise<AcceptResult> {
  if (!isInviteTokenShaped(token)) return { ok: false, reason: "invalid" };
  const [inv] = await tx.query<{
    id: string; organization_id: string; email: string; kind: InviteKind; role: string; party_id: string | null;
  }>(
    `select id, organization_id, email, kind, role, party_id from er_invitations
      where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now()
      for update`,
    [sha256Hex(token)],
  );
  if (!inv) return { ok: false, reason: "invalid" };
  if (!emailsMatch(inv.email, user.email)) {
    await audit(tx, { organizationId: inv.organization_id, userId: user.id, action: "accept_denied", entity: "invitation", entityId: inv.id, details: { reason: "email_mismatch" } });
    return { ok: false, reason: "email_mismatch" };
  }

  if (inv.kind === "staff") {
    // Jos käyttäjä on jo jäsen, roolia ei muuteta: kutsu ei saa alentaa
    // pääkäyttäjää eikä korottaa ketään ohi roolinvaihdon.
    await tx.query(
      "insert into er_org_members (organization_id, user_id, role) values ($1, $2, $3) on conflict (organization_id, user_id) do nothing",
      [inv.organization_id, user.id, inv.role],
    );
  } else {
    const linked = await tx.query(
      "update er_parties set user_id = $2 where id = $1 and (user_id is null or user_id = $2) returning id",
      [inv.party_id, user.id],
    );
    if (linked.length === 0) return { ok: false, reason: "party_taken" };

    const groups = await tx.query<{ share_group_id: string }>(
      `select share_group_id from er_ownerships where party_id = $1
       union select share_group_id from er_residencies where party_id = $1`,
      [inv.party_id],
    );
    for (const g of groups) await syncPortalAccessForGroup(tx, g.share_group_id);
    const boards = await tx.query<{ company_id: string }>("select distinct company_id from er_board_memberships where party_id = $1", [inv.party_id]);
    for (const b of boards) await syncPortalAccessForBoard(tx, b.company_id);
  }

  await tx.query("update er_invitations set accepted_at = now(), accepted_by = $2 where id = $1", [inv.id, user.id]);
  await audit(tx, { organizationId: inv.organization_id, userId: user.id, action: "accept", entity: "invitation", entityId: inv.id, details: { kind: inv.kind, role: inv.role } });
  return { ok: true, kind: inv.kind, organizationId: inv.organization_id };
}
