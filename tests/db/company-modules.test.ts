import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { loadCompanyModuleStatus } from "@/lib/registry/company-modules";
import { COMPANY_MODULES, companyModuleHref, companyModulesFor } from "@/config/company-tabs";

let db: Database;
let f: Fixture;
const today = "2026-09-15";

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    await tx.query(
      `insert into er_share_groups (organization_id, company_id, unit_label, kind)
       values ($1,$2,'A 1','apartment'), ($1,$2,'A 2','apartment'), ($1,$2,'AP 1','parking')`,
      [f.orgA, f.companyA],
    );
    await tx.query(
      `insert into er_tasks (organization_id, company_id, title, due_on) values ($1,$2,'Myöhässä','2026-09-01'), ($1,$2,'Tuleva','2026-10-12')`,
      [f.orgA, f.companyA],
    );
  });
});
afterAll(async () => db.close());

const companyA = () => ({ id: f.companyA, organization_id: f.orgA, htj_synced_at: null });

describe("yhtiön korttinäkymän tilarivit", () => {
  it("laskee luvut yhdellä kyselyjoukolla", async () => {
    const s = await db.asUser(f.managerA.sub, (tx) => loadCompanyModuleStatus(tx, companyA(), today));
    expect(s.huoneistot?.text).toBe("2 huoneistoa + 1 muuta");
    expect(s.vuosikello).toEqual({ text: "1 tehtävä myöhässä", tone: "alert" });
    expect(s.huolto?.text).toBe("Ei avoimia pyyntöjä");
    expect(s.htj?.text).toBe("Ei HTJ-vertailua");
    expect(s.kokoukset?.text).toBe("Ei tulevia kokouksia");
  });

  it("toimii myös kirjanpitäjälle", async () => {
    const s = await db.asUser(f.accountantA.sub, (tx) => loadCompanyModuleStatus(tx, companyA(), today));
    expect(s.huoneistot?.text).toBe("2 huoneistoa + 1 muuta");
  });

  it("toisen organisaation käyttäjä ei näe lukuja (RLS)", async () => {
    const s = await db.asUser(f.managerB.sub, (tx) => loadCompanyModuleStatus(tx, companyA(), today));
    expect(s.huoneistot?.text).toBe("Ei huoneistoja");
    expect(s.vuosikello).toBeUndefined();
  });
});

describe("yhtiön moduulit", () => {
  it("rajaa roolin mukaan ja muodostaa polut", () => {
    expect(companyModulesFor("accountant").some((m) => m.key === "todistukset")).toBe(false);
    expect(companyModulesFor("manager")).toHaveLength(COMPANY_MODULES.length);
    expect(companyModuleHref("x", "perustiedot")).toBe("/taloyhtiot/x/perustiedot");
    expect(new Set(COMPANY_MODULES.map((m) => m.path)).size).toBe(COMPANY_MODULES.length);
  });
});
