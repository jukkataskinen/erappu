import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import {
  acceptInvitation,
  createPortalInvitation,
  createStaffInvitation,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
} from "@/lib/invitations";
import { loadPortalHome } from "@/lib/settings/portal-home";
import { sha256Hex } from "@/lib/security/crypto";

let db: Database;
let f: Fixture;
let ownerA: { id: string; sub: string };

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  ownerA = await createUser(db, "omistaja.a@example.test");
  await db.asService((tx) => tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'owner')", [f.orgA, ownerA.id]));
});
afterAll(async () => db.close());

describe("henkilökuntakutsu", () => {
  it("tallentaa vain tiivisteen, jonottaa viestin ja kirjaa lokiin", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "Uusi.Kirjanpitaja@Example.test", role: "accountant" }),
    );
    expect(res.status).toBe("sent");
    if (res.status !== "sent") return;
    const row = await db.asService((tx) =>
      one<{ token_hash: string; email: string; days: number }>(tx, "select token_hash, email, round(extract(epoch from expires_at - now()) / 86400)::int as days from er_invitations where id = $1", [res.invitationId]),
    );
    expect(row.token_hash).toBe(sha256Hex(res.token));
    expect(row.token_hash).not.toContain(res.token);
    expect(row.email).toBe("uusi.kirjanpitaja@example.test");
    expect(row.days).toBe(14);
    const msgs = await db.asService((tx) => tx.query<{ body: string }>("select body from er_outbound_messages where subject_id = $1", [res.invitationId]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain(`/kutsu/${res.token}`);
    const logs = await db.asService((tx) => tx.query<{ details: Record<string, unknown> }>("select details from er_audit_log where entity = 'invitation' and entity_id = $1", [res.invitationId]));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0].details)).not.toContain("@");
  });

  it("isännöitsijä ei voi kutsua pääkäyttäjää, eikä RLS päästä kiertämään", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "x@example.test", role: "owner" }),
    );
    expect(res.status).toBe("forbidden_role");
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at) values ($1,'x@example.test','staff','owner','h1', now() + interval '1 day')", [f.orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("pääkäyttäjä voi kutsua pääkäyttäjän", async () => {
    const res = await db.asUser(ownerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: ownerA.id, inviterRole: "owner", email: "toinen.omistaja@example.test", role: "owner" }),
    );
    expect(res.status).toBe("sent");
  });

  it("kirjanpitäjä ei näe eikä luo kutsuja", async () => {
    const rows = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_invitations"));
    expect(rows).toHaveLength(0);
    await expect(
      db.asUser(f.accountantA.sub, (tx) =>
        tx.query("insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at) values ($1,'y@example.test','staff','assistant','h2', now() + interval '1 day')", [f.orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("toisen organisaation isännöitsijä ei näe kutsuja", async () => {
    const rows = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_invitations where organization_id = $1", [f.orgA]));
    expect(rows).toHaveLength(0);
  });

  it("väärä sähköposti hylätään, oikea luo jäsenyyden, käytetty kutsu hylätään", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "assari@example.test", role: "assistant" }),
    );
    if (res.status !== "sent") throw new Error("kutsu ei lähtenyt");

    const preview = await db.asService((tx) => previewInvitation(tx, res.token));
    expect(preview).toEqual({ kind: "staff", organizationName: "Isännöinti A", companyName: null, roleLabel: "Assistentti" });

    const wrong = await createUser(db, "joku.muu@example.test");
    const denied = await db.asService((tx) => acceptInvitation(tx, res.token, { id: wrong.id, email: "joku.muu@example.test" }));
    expect(denied).toEqual({ ok: false, reason: "email_mismatch" });
    const notMember = await db.asService((tx) => tx.query("select 1 from er_org_members where user_id = $1", [wrong.id]));
    expect(notMember).toHaveLength(0);

    const right = await createUser(db, "Assari@Example.test");
    const ok = await db.asService((tx) => acceptInvitation(tx, res.token, { id: right.id, email: "Assari@Example.test" }));
    expect(ok).toEqual({ ok: true, kind: "staff", organizationId: f.orgA });
    const member = await db.asService((tx) => one<{ role: string }>(tx, "select role from er_org_members where user_id = $1 and organization_id = $2", [right.id, f.orgA]));
    expect(member.role).toBe("assistant");

    const again = await db.asService((tx) => acceptInvitation(tx, res.token, { id: right.id, email: "assari@example.test" }));
    expect(again).toEqual({ ok: false, reason: "invalid" });
    expect(await db.asService((tx) => previewInvitation(tx, res.token))).toBeNull();
  });

  it("vanhentunut ja peruttu kutsu hylätään", async () => {
    const expired = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "vanha@example.test", role: "assistant" }),
    );
    if (expired.status !== "sent") throw new Error("kutsu ei lähtenyt");
    await db.asService((tx) => tx.query("update er_invitations set expires_at = now() - interval '1 minute' where id = $1", [expired.invitationId]));
    const u = await createUser(db, "vanha@example.test");
    expect(await db.asService((tx) => acceptInvitation(tx, expired.token, { id: u.id, email: "vanha@example.test" }))).toEqual({ ok: false, reason: "invalid" });

    const revoked = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "peruttu@example.test", role: "assistant" }),
    );
    if (revoked.status !== "sent") throw new Error("kutsu ei lähtenyt");
    expect(await db.asUser(f.managerA.sub, (tx) => revokeInvitation(tx, { organizationId: f.orgA, invitationId: revoked.invitationId, actorId: f.managerA.id }))).toBe(true);
    const u2 = await createUser(db, "peruttu@example.test");
    expect(await db.asService((tx) => acceptInvitation(tx, revoked.token, { id: u2.id, email: "peruttu@example.test" }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("uudelleenlähetys vaihtaa tokenin, vanha lakkaa toimimasta", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) =>
      createStaffInvitation(tx, { organizationId: f.orgA, inviterId: f.managerA.id, inviterRole: "manager", email: "uusinta@example.test", role: "manager" }),
    );
    if (res.status !== "sent") throw new Error("kutsu ei lähtenyt");
    const again = await db.asUser(f.managerA.sub, (tx) => resendInvitation(tx, { organizationId: f.orgA, invitationId: res.invitationId, actorId: f.managerA.id, actorRole: "manager" }));
    expect(again.status).toBe("sent");
    if (again.status !== "sent") return;
    expect(again.token).not.toBe(res.token);
    expect(await db.asService((tx) => previewInvitation(tx, res.token))).toBeNull();
    expect(await db.asService((tx) => previewInvitation(tx, again.token))).not.toBeNull();
  });

  it("muodoton token hylätään ennen kyselyä", async () => {
    expect(await db.asService((tx) => previewInvitation(tx, "' or 1=1 --"))).toBeNull();
  });
});

describe("portaalikutsu", () => {
  let groupA: string;
  let groupA2: string;
  let otherCompanyA: string;
  let partyId: string;
  let boardPartyId: string;

  beforeAll(async () => {
    await db.asService(async (tx) => {
      groupA = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1', 54.5) returning id", [f.orgA, f.companyA])).id;
      await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,100)", [f.orgA, f.companyA, groupA]);
      groupA2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id", [f.orgA, f.companyA])).id;
      partyId = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Olli','Osakas','Olli.Osakas@example.test') returning id", [f.orgA])).id;
      await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual')", [f.orgA, groupA, partyId]);
      const neighbour = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, email) values ($1,'Naapuri','naapuri@example.test') returning id", [f.orgA])).id;
      await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual')", [f.orgA, groupA2, neighbour]);
      otherCompanyA = (await one<{ id: string }>(tx, "insert into er_housing_companies (organization_id, name, business_id, manager_user_id) values ($1,'As Oy Toinen A','2345678-9',$2) returning id", [f.orgA, f.managerA.id])).id;
      await tx.query("insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'B 1')", [f.orgA, otherCompanyA]);
      await tx.query("update er_housing_companies set manager_user_id = $2 where id = $1", [f.companyA, f.managerA.id]);
      boardPartyId = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Hilda','Hallitus','hilda@example.test') returning id", [f.orgA])).id;
      await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair', current_date - 10)", [f.orgA, f.companyA, boardPartyId]);
    });
  });

  it("osapuoli ilman suhdetta yhtiöön ei kelpaa, toisen organisaation isännöitsijä ei löydä osapuolta", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => createPortalInvitation(tx, { partyId, companyId: otherCompanyA, role: "owner", inviterId: f.managerA.id }));
    expect(res.status).toBe("not_found");
    const resB = await db.asUser(f.managerB.sub, (tx) => createPortalInvitation(tx, { partyId, companyId: f.companyA, role: "owner", inviterId: f.managerB.id }));
    expect(resB.status).toBe("not_found");
  });

  it("hyväksyntä liittää osapuolen käyttäjään ja luo portaalioikeudet", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => createPortalInvitation(tx, { partyId, companyId: f.companyA, role: "owner", inviterId: f.managerA.id }));
    expect(res.status).toBe("sent");
    if (res.status !== "sent") return;
    const preview = await db.asService((tx) => previewInvitation(tx, res.token));
    expect(preview).toMatchObject({ kind: "portal", organizationName: "Isännöinti A", companyName: "As Oy Testi A" });

    const olli = await createUser(db, "olli.osakas@example.test");
    const ok = await db.asService((tx) => acceptInvitation(tx, res.token, { id: olli.id, email: "olli.osakas@example.test" }));
    expect(ok).toMatchObject({ ok: true, kind: "portal" });
    const party = await db.asService((tx) => one<{ user_id: string }>(tx, "select user_id from er_parties where id = $1", [partyId]));
    expect(party.user_id).toBe(olli.id);
    const access = await db.asService((tx) => tx.query<{ role: string; share_group_id: string }>("select role, share_group_id from er_portal_access where user_id = $1 and ends_on is null", [olli.id]));
    expect(access).toEqual([{ role: "owner", share_group_id: groupA }]);

    const again = await db.asUser(f.managerA.sub, (tx) => createPortalInvitation(tx, { partyId, companyId: f.companyA, role: "owner", inviterId: f.managerA.id }));
    expect(again.status).toBe("already_in_portal");
  });

  it("hallituksen jäsenen kutsu luo hallitusoikeuden", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => createPortalInvitation(tx, { partyId: boardPartyId, companyId: f.companyA, role: "board", inviterId: f.managerA.id }));
    if (res.status !== "sent") throw new Error(res.status);
    const hilda = await createUser(db, "hilda@example.test");
    await db.asService((tx) => acceptInvitation(tx, res.token, { id: hilda.id, email: "HILDA@example.test" }));
    const access = await db.asService((tx) => tx.query<{ role: string }>("select role from er_portal_access where user_id = $1", [hilda.id]));
    expect(access.map((a) => a.role)).toEqual(["board"]);
  });

  it("osapuoli ilman sähköpostia ei saa kutsua", async () => {
    const pid = await db.asService(async (tx) => {
      const p = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name) values ($1,'Ilman') returning id", [f.orgA])).id;
      await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,'tenant')", [f.orgA, groupA2, p]);
      return p;
    });
    const res = await db.asUser(f.managerA.sub, (tx) => createPortalInvitation(tx, { partyId: pid, companyId: f.companyA, role: "resident", inviterId: f.managerA.id }));
    expect(res.status).toBe("no_email");
  });

  it("oma huoneisto -näkymä näyttää vain käyttäjän oman huoneiston ja yhtiön", async () => {
    const olli = await db.asService((tx) => one<{ id: string; auth_sub: string }>(tx, "select id, auth_sub from er_users where email = 'olli.osakas@example.test'"));
    const home = await loadPortalHome(db, { id: olli.id, sub: olli.auth_sub });
    expect(home.units.map((u) => u.unit_label)).toEqual(["A 1"]);
    expect(home.units[0].roles).toEqual(["owner"]);
    expect(home.units[0].ranges).toEqual([{ first: 1, last: 100 }]);
    expect(home.companies.map((c) => c.id)).toEqual([f.companyA]);
    expect(home.companies[0].manager?.email).toBe((await db.asService((tx) => one<{ email: string }>(tx, "select email from er_users where id = $1", [f.managerA.id]))).email);
    expect(home.companies[0].board).toBeNull();

    // Suora kysely RLS:llä: toisen yhtiön ja naapurin huoneiston tiedot eivät näy.
    const groups = await db.asUser(olli.auth_sub, (tx) => tx.query<{ unit_label: string }>("select unit_label from er_share_groups order by unit_label"));
    expect(groups.map((g) => g.unit_label)).toEqual(["A 1"]);
    const companies = await db.asUser(olli.auth_sub, (tx) => tx.query<{ id: string }>("select id from er_housing_companies"));
    expect(companies.map((c) => c.id)).toEqual([f.companyA]);
    const users = await db.asUser(olli.auth_sub, (tx) => tx.query<{ id: string }>("select id from er_users"));
    expect(users.map((u) => u.id)).toEqual([olli.id]);
  });

  it("hallituksen jäsen näkee hallituksen", async () => {
    const hilda = await db.asService((tx) => one<{ id: string; auth_sub: string }>(tx, "select id, auth_sub from er_users where email = 'hilda@example.test'"));
    const home = await loadPortalHome(db, { id: hilda.id, sub: hilda.auth_sub });
    expect(home.units).toHaveLength(0);
    expect(home.companies[0].board?.map((b) => b.display_name)).toEqual(["Hilda Hallitus"]);
  });
});
