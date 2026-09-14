import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { searchRegistry } from "@/lib/registry/search";

let db: Database;
let f: Fixture;
let owner: { id: string; sub: string };
let tenant: { id: string; sub: string };
let chair: { id: string; sub: string };
let unit1: string;
let unit2: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner = await createUser(db, "osakas@example.test");
  tenant = await createUser(db, "asukas@example.test");
  chair = await createUser(db, "pj@example.test");
  await db.asService(async (tx) => {
    unit1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id", [f.orgA, f.companyA])).id;
    unit2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id", [f.orgA, f.companyA])).id;
    const pOwner = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Olli','Osakas',$2) returning id", [f.orgA, owner.id])).id;
    const pTenant = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Anna','Asukas',$2) returning id", [f.orgA, tenant.id])).id;
    const pChair = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Paula','Pj',$2) returning id", [f.orgA, chair.id])).id;
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id) values ($1,$2,$3)", [f.orgA, unit1, pOwner]);
    await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,'tenant')", [f.orgA, unit2, pTenant]);
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair', current_date - 1)", [f.orgA, f.companyA, pChair]);
    await syncPortalAccessForGroup(tx, unit1);
    await syncPortalAccessForGroup(tx, unit2);
    await syncPortalAccessForBoard(tx, f.companyA);
  });
});
afterAll(async () => db.close());

describe("portaalioikeudet", () => {
  it("osakas näkee oman yhtiönsä ja huoneistonsa mutta ei naapuria", async () => {
    const companies = await db.asUser(owner.sub, (tx) => tx.query<{ id: string }>("select id from er_housing_companies"));
    expect(companies.map((c) => c.id)).toEqual([f.companyA]);
    const units = await db.asUser(owner.sub, (tx) => tx.query<{ id: string }>("select id from er_share_groups"));
    expect(units.map((u) => u.id)).toEqual([unit1]);
  });

  it("hallituksen puheenjohtaja näkee yhtiön kaikki huoneistot", async () => {
    const units = await db.asUser(chair.sub, (tx) => tx.query<{ id: string }>("select id from er_share_groups order by unit_label"));
    expect(units.map((u) => u.id)).toEqual([unit1, unit2]);
  });

  it("asukas ei näe toisen organisaation yhtiötä eikä voi muokata rekisteriä", async () => {
    const other = await db.asUser(tenant.sub, (tx) => tx.query("select id from er_housing_companies where id = $1", [f.companyB]));
    expect(other).toHaveLength(0);
    const upd = await db.asUser(tenant.sub, (tx) => tx.query("update er_share_groups set unit_label = 'X' where id = $1 returning id", [unit2]));
    expect(upd).toHaveLength(0);
  });

  it("omistuksen päättyminen päättää portaalioikeuden", async () => {
    await db.asService(async (tx) => {
      await tx.query("update er_ownerships set ends_on = current_date - 1 where share_group_id = $1", [unit1]);
      await syncPortalAccessForGroup(tx, unit1);
    });
    const companies = await db.asUser(owner.sub, (tx) => tx.query("select id from er_housing_companies"));
    expect(companies).toHaveLength(0);
  });
});

describe("haku", () => {
  it("löytää huoneiston yhtiön nimellä ja tunnuksella, ja rajautuu organisaatioon", async () => {
    const hits = await db.asUser(f.managerA.sub, (tx) => searchRegistry(tx, f.orgA, "Testi A 2"));
    expect(hits.some((h) => h.kind === "unit" && h.id === unit2)).toBe(true);
    const cross = await db.asUser(f.managerB.sub, (tx) => searchRegistry(tx, f.orgA, "Testi"));
    expect(cross).toHaveLength(0);
  });
});
