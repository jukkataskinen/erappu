import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";

let db: Database;
let f: Fixture;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
});
afterAll(async () => db.close());

describe("organisaatioeristys", () => {
  it("isännöitsijä näkee vain oman organisaationsa taloyhtiöt", async () => {
    const rows = await db.asUser(f.managerA.sub, (tx) => tx.query<{ id: string }>("select id from er_housing_companies"));
    expect(rows.map((r) => r.id)).toEqual([f.companyA]);
  });

  it("toisen organisaation taloyhtiötä ei voi päivittää (0 riviä)", async () => {
    const rows = await db.asUser(f.managerA.sub, (tx) =>
      tx.query("update er_housing_companies set name = 'kaapattu' where id = $1 returning id", [f.companyB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("toiseen organisaatioon ei voi lisätä taloyhtiötä", async () => {
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_housing_companies (organization_id, name, business_id) values ($1, 'x', '1111111-1')", [f.orgB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("kirjanpitäjä lukee mutta ei muokkaa rekisteriä", async () => {
    const read = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_housing_companies"));
    expect(read).toHaveLength(1);
    const upd = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query("update er_housing_companies set name = 'muutos' where id = $1 returning id", [f.companyA]),
    );
    expect(upd).toHaveLength(0);
  });

  it("tuntematon käyttäjä ei näe mitään", async () => {
    const rows = await db.asUser("test|tuntematon", (tx) => tx.query("select id from er_housing_companies"));
    expect(rows).toHaveLength(0);
  });

  it("henkilötunnustaulua ei voi lukea käyttäjäroolilla", async () => {
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("select * from er_party_identifiers"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("osakevälit", () => {
  it("päällekkäiset osakevälit estetään ja osakemäärä lasketaan väleistä", async () => {
    await db.asUser(f.managerA.sub, async (tx) => {
      const [g1] = await tx.query<{ id: string }>(
        "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id",
        [f.orgA, f.companyA],
      );
      const [g2] = await tx.query<{ id: string }>(
        "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id",
        [f.orgA, f.companyA],
      );
      await tx.query(
        "insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,143),($1,$2,$4,144,241)",
        [f.orgA, f.companyA, g1.id, g2.id],
      );
      const [c] = await tx.query<{ share_count: number }>("select share_count from er_share_groups where id = $1", [g1.id]);
      expect(c.share_count).toBe(143);
    });

    await expect(
      db.asUser(f.managerA.sub, async (tx) => {
        const [g] = await tx.query<{ id: string }>("select id from er_share_groups where unit_label = 'A 2'");
        await tx.query(
          "insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,200,260)",
          [f.orgA, f.companyA, g.id],
        );
      }),
    ).rejects.toThrow(/conflicting key value|exclusion constraint/);
  });
});
