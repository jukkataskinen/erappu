import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { loadCompanyModuleStatus } from "@/lib/registry/company-modules";
import { syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { deleteException, listExceptions, saveException } from "@/lib/responsibility/queries";

let db: Database;
let f: Fixture;
let assistantA: { id: string; sub: string };
let residentA: { id: string; sub: string };
let residentB: { id: string; sub: string };

async function resident(tx: Sql, org: string, company: string, unit: string, userId: string) {
  const g = await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,$3,60) returning id", [org, company, unit]);
  const p = await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Testi','Asukas',$2) returning id", [org, userId]);
  await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'tenant','2024-01-01')", [org, g.id, p.id]);
  await syncPortalAccessForGroup(tx, g.id);
}

const lasit = (companyId: string, userId: string) => ({
  companyId,
  userId,
  itemKey: "parveke-lasit",
  responsibility: "shareholder" as const,
  basis: "articles" as const,
  note: "Yhtiöjärjestyksen 4 §: osakas vastaa parvekelasien kunnossapidosta.",
  decidedOn: "2025-05-20",
});

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  assistantA = await createUser(db);
  residentA = await createUser(db);
  residentB = await createUser(db);
  await db.asService(async (tx) => {
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'assistant')", [f.orgA, assistantA.id]);
    await resident(tx, f.orgA, f.companyA, "A 1", residentA.id);
    await resident(tx, f.orgB, f.companyB, "B 1", residentB.id);
  });
});

afterAll(async () => {
  await db.close();
});

describe("vastuunjako: poikkeusten tallennus", () => {
  it("isännöitsijä lisää poikkeuksen, ja uusi tallennus samalle kohteelle korvaa sen", async () => {
    const first = await db.asUser(f.managerA.sub, (tx) => saveException(tx, lasit(f.companyA, f.managerA.id)));
    expect(first.created).toBe(true);
    const second = await db.asUser(assistantA.sub, (tx) => saveException(tx, { ...lasit(f.companyA, assistantA.id), basis: "meeting", note: "Yhtiökokous 2026" }));
    expect(second).toEqual({ id: first.id, created: false });

    const rows = await db.asUser(f.managerA.sub, (tx) => listExceptions(tx, f.companyA));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_key: "parveke-lasit", responsibility: "shareholder", basis: "meeting", note: "Yhtiökokous 2026", decided_on: "2025-05-20" });

    const log = await db.asService((tx) => tx.query<{ action: string }>("select action from er_audit_log where entity = 'responsibility_exception' and entity_id = $1 order by created_at", [first.id]));
    expect(log.map((l) => l.action)).toEqual(["create", "update"]);
  });

  it("kanta hylkää tuntemattoman vastuun ja tyhjän perustelun", async () => {
    await expect(db.asUser(f.managerA.sub, (tx) => saveException(tx, { ...lasit(f.companyA, f.managerA.id), itemKey: "piha-aidat", responsibility: "nobody" as never }))).rejects.toThrow();
    await expect(db.asUser(f.managerA.sub, (tx) => saveException(tx, { ...lasit(f.companyA, f.managerA.id), itemKey: "piha-aidat", note: "  " }))).rejects.toThrow();
  });

  it("kirjanpitäjä näkee poikkeukset mutta ei voi muokata", async () => {
    const rows = await db.asUser(f.accountantA.sub, (tx) => listExceptions(tx, f.companyA));
    expect(rows).toHaveLength(1);
    await expect(db.asUser(f.accountantA.sub, (tx) => saveException(tx, { ...lasit(f.companyA, f.accountantA.id), itemKey: "piha-aidat" }))).rejects.toThrow();
    const deleted = await db.asUser(f.accountantA.sub, (tx) => deleteException(tx, { companyId: f.companyA, userId: f.accountantA.id, itemKey: "parveke-lasit" }));
    expect(deleted).toBe(false);
  });
});

describe("vastuunjako: RLS", () => {
  it("toisen organisaation henkilökunta ei näe eikä voi kirjoittaa poikkeuksia", async () => {
    expect(await db.asUser(f.managerB.sub, (tx) => listExceptions(tx, f.companyA))).toHaveLength(0);
    await expect(db.asUser(f.managerB.sub, (tx) => saveException(tx, { ...lasit(f.companyA, f.managerB.id), itemKey: "piha-aidat" }))).rejects.toThrow();
    // Suora lisäys oman organisaation tunnuksella toisen organisaation yhtiöön estyy with check -ehdolla.
    await expect(
      db.asUser(f.managerB.sub, (tx) =>
        tx.query("insert into er_responsibility_exceptions (organization_id, company_id, item_key, responsibility, note) values ($1,$2,'piha-aidat','shareholder','x')", [f.orgB, f.companyA]),
      ),
    ).rejects.toThrow();
    const deleted = await db.asUser(f.managerB.sub, (tx) => deleteException(tx, { companyId: f.companyA, userId: f.managerB.id, itemKey: "parveke-lasit" }));
    expect(deleted).toBe(false);
  });

  it("portaalin asukas näkee oman yhtiönsä poikkeukset, mutta ei toisen yhtiön eikä voi muokata", async () => {
    await db.asUser(f.managerB.sub, (tx) => saveException(tx, { ...lasit(f.companyB, f.managerB.id), itemKey: "piha-alue", responsibility: "shareholder" }));

    const own = await db.asUser(residentA.sub, (tx) => listExceptions(tx, f.companyA));
    expect(own.map((r) => r.item_key)).toEqual(["parveke-lasit"]);
    expect(await db.asUser(residentA.sub, (tx) => listExceptions(tx, f.companyB))).toHaveLength(0);
    expect((await db.asUser(residentB.sub, (tx) => listExceptions(tx, f.companyB))).map((r) => r.item_key)).toEqual(["piha-alue"]);
    expect(await db.asUser(residentB.sub, (tx) => listExceptions(tx, f.companyA))).toHaveLength(0);

    await expect(db.asUser(residentA.sub, (tx) => saveException(tx, { ...lasit(f.companyA, residentA.id), itemKey: "piha-aidat" }))).rejects.toThrow();
    expect(await db.asUser(residentA.sub, (tx) => deleteException(tx, { companyId: f.companyA, userId: residentA.id, itemKey: "parveke-lasit" }))).toBe(false);
  });
});

describe("vastuunjako: moduulikortti ja poisto", () => {
  it("kortti kertoo poikkeusten määrän, ja poiston jälkeen yleisen jaon", async () => {
    const company = { id: f.companyA, organization_id: f.orgA, htj_synced_at: null };
    const before = await db.asUser(f.managerA.sub, (tx) => loadCompanyModuleStatus(tx, company, "2026-09-16"));
    expect(before.vastuunjako?.text).toBe("1 yhtiökohtainen poikkeus");

    expect(await db.asUser(f.managerA.sub, (tx) => deleteException(tx, { companyId: f.companyA, userId: f.managerA.id, itemKey: "parveke-lasit" }))).toBe(true);
    const after = await db.asUser(f.managerA.sub, (tx) => loadCompanyModuleStatus(tx, company, "2026-09-16"));
    expect(after.vastuunjako?.text).toBe("Lain mukainen yleinen jako");
  });
});
