import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { changeMemberRole, listMembers, removeMember } from "@/lib/settings/members";
import { getOrganization, organizationSchema, updateOrganization } from "@/lib/settings/organization";
import { listAuditLog } from "@/lib/settings/audit-log";
import { listPortalUsers } from "@/lib/settings/portal-users";
import { listOwnParties, setOwnNoticeConsent, updateOwnProfile } from "@/lib/settings/profile";
import { audit } from "@/lib/audit";

let db: Database;
let f: Fixture;
let ownerA: { id: string; sub: string };

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  ownerA = await createUser(db);
  await db.asService((tx) => tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'owner')", [f.orgA, ownerA.id]));
});
afterAll(async () => db.close());

describe("jäsenet ja pääkäyttäjä", () => {
  it("viimeistä pääkäyttäjää ei voi alentaa eikä poistaa", async () => {
    const demote = await db.asUser(ownerA.sub, (tx) => changeMemberRole(tx, { organizationId: f.orgA, actorId: ownerA.id, actorRole: "owner", userId: ownerA.id, role: "manager" }));
    expect(demote).toBe("last_owner");
    const remove = await db.asUser(ownerA.sub, (tx) => removeMember(tx, { organizationId: f.orgA, actorId: ownerA.id, actorRole: "owner", userId: ownerA.id }));
    expect(remove).toBe("last_owner");
  });

  it("trigger estää viimeisen pääkäyttäjän poiston myös suoralla kyselyllä", async () => {
    await expect(
      db.asService((tx) => tx.query("delete from er_org_members where organization_id = $1 and user_id = $2", [f.orgA, ownerA.id])),
    ).rejects.toThrow(/er_last_owner/);
    await expect(
      db.asService((tx) => tx.query("update er_org_members set role = 'manager' where organization_id = $1 and user_id = $2", [f.orgA, ownerA.id])),
    ).rejects.toThrow(/er_last_owner/);
  });

  it("isännöitsijä ei voi vaihtaa rooleja (sovellus ja RLS)", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => changeMemberRole(tx, { organizationId: f.orgA, actorId: f.managerA.id, actorRole: "manager", userId: f.accountantA.id, role: "manager" }));
    expect(res).toBe("forbidden");
    const rows = await db.asUser(f.managerA.sub, (tx) => tx.query("update er_org_members set role = 'owner' where user_id = $1 returning user_id", [f.managerA.id]));
    expect(rows).toHaveLength(0);
  });

  it("pääkäyttäjä vaihtaa roolin ja poistaa jäsenen; toisen pääkäyttäjän jälkeen itsensä alentaminen onnistuu", async () => {
    expect(await db.asUser(ownerA.sub, (tx) => changeMemberRole(tx, { organizationId: f.orgA, actorId: ownerA.id, actorRole: "owner", userId: f.managerA.id, role: "owner" }))).toBe("ok");
    expect(await db.asUser(ownerA.sub, (tx) => changeMemberRole(tx, { organizationId: f.orgA, actorId: ownerA.id, actorRole: "owner", userId: ownerA.id, role: "manager" }))).toBe("ok");
    // managerA on nyt ainoa pääkäyttäjä.
    expect(await db.asUser(f.managerA.sub, (tx) => removeMember(tx, { organizationId: f.orgA, actorId: f.managerA.id, actorRole: "owner", userId: f.managerA.id }))).toBe("last_owner");
    const extra = await createUser(db);
    await db.asService((tx) => tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'assistant')", [f.orgA, extra.id]));
    expect(await db.asUser(f.managerA.sub, (tx) => removeMember(tx, { organizationId: f.orgA, actorId: f.managerA.id, actorRole: "owner", userId: extra.id }))).toBe("ok");
    const members = await db.asUser(f.managerA.sub, (tx) => listMembers(tx, f.orgA));
    expect(members.map((m) => m.user_id)).not.toContain(extra.id);
    expect(members[0].role).toBe("owner");
  });

  it("toisen organisaation jäseniä ei näe", async () => {
    const members = await db.asUser(f.managerB.sub, (tx) => listMembers(tx, f.orgA));
    expect(members).toHaveLength(0);
  });
});

describe("organisaation asetukset", () => {
  it("Y-tunnus validoidaan", () => {
    expect(organizationSchema.safeParse({ name: "Testi Oy", business_id: "1234567-8" }).success).toBe(false);
    const ok = organizationSchema.safeParse({ name: "Testi Oy", business_id: "0000001-9", certificate_standard_eur: "150,50" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.certificate_standard_eur).toBe(150.5);
  });

  it("päivitys yhdistää settings-kentän ja vain pääkäyttäjä voi päivittää", async () => {
    await db.asService((tx) => tx.query(`update er_organizations set settings = '{"muu_moduuli": {"x": 1}}' where id = $1`, [f.orgA]));
    const input = organizationSchema.parse({ name: "Isännöinti A Oy", business_id: "0000001-9", phone: "010 123", certificate_standard_eur: "120" });
    // managerA on edellisen testin jälkeen owner; organisaatio B:n isännöitsijä ei voi päivittää A:ta.
    expect(await db.asUser(f.managerB.sub, (tx) => updateOrganization(tx, f.orgA, f.managerB.id, input))).toBe(false);
    expect(await db.asUser(f.accountantA.sub, (tx) => updateOrganization(tx, f.orgA, f.accountantA.id, input))).toBe(false);
    expect(await db.asUser(f.managerA.sub, (tx) => updateOrganization(tx, f.orgA, f.managerA.id, input))).toBe(true);
    const org = await db.asService((tx) => getOrganization(tx, f.orgA));
    expect(org?.name).toBe("Isännöinti A Oy");
    expect(org?.settings).toMatchObject({ muu_moduuli: { x: 1 }, contact: { phone: "010 123" }, certificate_prices: { standard_eur: 120 } });
  });
});

describe("tapahtumaloki", () => {
  it("näkyy owner/managerille ilman details-kenttää, ei kirjanpitäjälle eikä toiselle organisaatiolle", async () => {
    await db.asService((tx) => audit(tx, { organizationId: f.orgA, userId: f.managerA.id, action: "read_hetu", entity: "party", details: { note: "salainen" } }));
    const rows = await db.asUser(f.managerA.sub, (tx) => listAuditLog(tx, f.orgA, { action: "read_hetu" }));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain("details");
    expect(await db.asUser(f.accountantA.sub, (tx) => listAuditLog(tx, f.orgA))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => listAuditLog(tx, f.orgA))).toHaveLength(0);
  });
});

describe("portaalikäyttäjän profiili ja suostumus", () => {
  let portalUser: { id: string; sub: string };
  let ownParty1: string;
  let ownParty2: string;
  let otherParty: string;

  beforeAll(async () => {
    portalUser = await createUser(db, "portaali@example.test");
    await db.asService(async (tx) => {
      const g = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'C 3') returning id", [f.orgA, f.companyA])).id;
      ownParty1 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, user_id) values ($1,'Oma1',$2) returning id", [f.orgA, portalUser.id])).id;
      ownParty2 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, user_id) values ($1,'Oma2',$2) returning id", [f.orgB, portalUser.id])).id;
      otherParty = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name) values ($1,'Vieras') returning id", [f.orgA])).id;
      await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual')", [f.orgA, g, ownParty1]);
      await tx.query("insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values ($1,$2,$3,$4,'owner','ownership:test')", [f.orgA, portalUser.id, f.companyA, g]);
    });
  });

  it("portaalikäyttäjä ei voi päivittää er_parties-riviä suoraan", async () => {
    const rows = await db.asUser(portalUser.sub, (tx) => tx.query("update er_parties set electronic_notice_consent = true where id = $1 returning id", [ownParty1]));
    expect(rows).toHaveLength(0);
  });

  it("suostumuksen päivitys koskee vain omaa riviä ja kirjataan lokiin", async () => {
    expect(await setOwnNoticeConsent(db, portalUser, otherParty, true)).toBe(0);
    expect(await setOwnNoticeConsent(db, portalUser, ownParty1, true)).toBe(1);
    const rows = await db.asService((tx) =>
      tx.query<{ id: string; electronic_notice_consent: boolean }>("select id, electronic_notice_consent from er_parties where id = any($1::uuid[]) order by last_name", [[ownParty1, ownParty2, otherParty]]),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.electronic_notice_consent]));
    expect(byId).toEqual({ [ownParty1]: true, [ownParty2]: false, [otherParty]: false });
    const log = await db.asService((tx) => tx.query("select 1 from er_audit_log where entity = 'party_notice_consent' and entity_id = $1 and user_id = $2", [ownParty1, portalUser.id]));
    expect(log).toHaveLength(1);
  });

  it("omat osapuolirivit ja profiilin päivitys", async () => {
    const parties = await db.asUser(portalUser.sub, (tx) => listOwnParties(tx));
    expect(parties.map((p) => p.id).sort()).toEqual([ownParty1, ownParty2].sort());
    await updateOwnProfile(db, portalUser, { fullName: "Paula Portaali", phone: "040 1" });
    const u = await db.asService((tx) => one<{ full_name: string; phone: string }>(tx, "select full_name, phone from er_users where id = $1", [portalUser.id]));
    expect(u).toEqual({ full_name: "Paula Portaali", phone: "040 1" });
  });

  it("portaalikäyttäjät näkyvät oman organisaation isännöitsijälle osapuolen nimellä", async () => {
    const rows = await db.asUser(f.managerA.sub, (tx) => listPortalUsers(tx, f.orgA));
    expect(rows.map((r) => r.person)).toContain("Oma1");
    expect(rows.every((r) => r.person !== "Oma2")).toBe(true);
    expect(await db.asUser(f.accountantA.sub, (tx) => listPortalUsers(tx, f.orgA))).toHaveLength(0);
  });
});
