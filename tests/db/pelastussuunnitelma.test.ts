import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { buildPrefill, refreshFromRegistry } from "@/lib/rescue-plans/prefill";
import { loadSafetyInfo, safetySchema, saveSafetyInfo } from "@/lib/registry/safety";
import { loadRegistrySnapshot } from "@/lib/rescue-plans/registry";
import { createDraft, currentAndDraft, deleteDraft, finalizeDraft, listPlans, REVIEW_TASK_KEY, saveDraft } from "@/lib/rescue-plans/queries";
import { loadCompanyModuleStatus } from "@/lib/registry/company-modules";

let db: Database;
let f: Fixture;
let assistantA: { id: string; sub: string };
let residentA: { id: string; sub: string };
let residentB: { id: string; sub: string };

const TODAY = "2026-09-15";

async function resident(tx: Sql, org: string, company: string, unit: string, userId: string) {
  const g = await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,$3,60) returning id", [org, company, unit]);
  const p = await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Testi','Asukas',$2) returning id", [org, userId]);
  await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'tenant','2024-01-01')", [org, g.id, p.id]);
  await syncPortalAccessForGroup(tx, g.id);
}

let pathCounter = 0;
const fakeDocument = (title: string) => ({
  title,
  fileName: "pelastussuunnitelma.pdf",
  storagePath: `test/pelastus/${++pathCounter}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 1000,
  sha256: "0".repeat(64),
});

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  assistantA = await createUser(db);
  residentA = await createUser(db);
  residentB = await createUser(db);
  await db.asService(async (tx) => {
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'assistant')", [f.orgA, assistantA.id]);
    await tx.query("update er_housing_companies set street_address = 'Testitie 1', postal_code = '41660', city = 'Toivakka', manager_user_id = $2 where id = $1", [f.companyA, f.managerA.id]);
    await tx.query(
      `insert into er_buildings (organization_id, company_id, label, building_type, completed_year, floors, heating, heating_type, common_spaces)
       values ($1,$2,'A','Rivitalo',1992,1,'Kaukolämpö','district_heat','{sauna}')`,
      [f.orgA, f.companyA],
    );
    await tx.query("insert into er_properties (organization_id, company_id, property_code) values ($1,$2,'850-405-5-900')", [f.orgA, f.companyA]);
    await resident(tx, f.orgA, f.companyA, "A 1", residentA.id);
    await resident(tx, f.orgB, f.companyB, "B 1", residentB.id);
  });
});

afterAll(async () => {
  await db.close();
});

describe("pelastussuunnitelma: esitäyttö kannasta", () => {
  it("rekisterin tiedot tulevat luonnokseen", async () => {
    const snapshot = await db.asUser(f.managerA.sub, (tx) => loadRegistrySnapshot(tx, f.companyA, TODAY));
    expect(snapshot).not.toBeNull();
    const content = buildPrefill(snapshot!);
    expect(content.address).toBe("Testitie 1, 41660 Toivakka");
    expect(content.propertyCodes).toBe("850-405-5-900");
    expect(content.apartments).toContain("1 asuinhuoneistoa");
    expect(content.residentsEstimate).toBe("noin 1");
    expect(content.commonSpaces).toBe("sauna");
    expect(content.buildings[0]).toMatchObject({ label: "A", completedYear: "1992" });
  });

  it("toisen organisaation yhtiön rekisteriä ei saa", async () => {
    expect(await db.asUser(f.managerB.sub, (tx) => loadRegistrySnapshot(tx, f.companyA, TODAY))).toBeNull();
  });
});

describe("pelastussuunnitelma: RLS ja versiointi", () => {
  let draftId: string;
  let firstDocumentId: string;
  let firstTaskId: string;

  it("isännöitsijä luo luonnoksen; toinen organisaatio ei näe eikä voi luoda", async () => {
    const content = await db.asUser(f.managerA.sub, async (tx) => buildPrefill((await loadRegistrySnapshot(tx, f.companyA, TODAY))!));
    const created = await db.asUser(f.managerA.sub, (tx) => createDraft(tx, { organizationId: f.orgA, companyId: f.companyA, userId: f.managerA.id, content }));
    expect(created.created).toBe(true);
    draftId = created.id;

    const again = await db.asUser(f.managerA.sub, (tx) => createDraft(tx, { organizationId: f.orgA, companyId: f.companyA, userId: f.managerA.id, content }));
    expect(again).toEqual({ id: draftId, created: false });

    expect(await db.asUser(f.managerB.sub, (tx) => listPlans(tx, f.companyA))).toEqual([]);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_rescue_plans"))).toEqual([]);
    await expect(
      db.asUser(f.managerB.sub, (tx) => tx.query("insert into er_rescue_plans (organization_id, company_id, version) values ($1,$2,99)", [f.orgA, f.companyA])),
    ).rejects.toThrow();
    // Oman organisaation rivi ei saa osoittaa toisen organisaation yhtiöön.
    await expect(
      db.asUser(f.managerB.sub, (tx) => tx.query("insert into er_rescue_plans (organization_id, company_id, version) values ($1,$2,99)", [f.orgB, f.companyA])),
    ).rejects.toThrow();
    const updated = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_rescue_plans set content = '{}' where id = $1 returning id", [draftId]));
    expect(updated).toEqual([]);
  });

  it("kirjanpitäjä lukee mutta ei muokkaa; avustaja muokkaa", async () => {
    expect(await db.asUser(f.accountantA.sub, (tx) => listPlans(tx, f.companyA))).toHaveLength(1);
    const blocked = await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_rescue_plans set prepared_on = '2026-09-15' where id = $1 returning id", [draftId]));
    expect(blocked).toEqual([]);
    await db.asUser(assistantA.sub, async (tx) => {
      const [plan] = await listPlans(tx, f.companyA);
      await saveDraft(tx, {
        planId: draftId, userId: assistantA.id, content: { ...plan.content, assemblyPoint: "Jätekatoksen edessä" },
        preparedOn: TODAY, nextReviewOn: "2027-09-15", visibility: "residents",
      });
    });
    const [plan] = await db.asUser(f.managerA.sub, (tx) => listPlans(tx, f.companyA));
    expect(plan.content.assemblyPoint).toBe("Jätekatoksen edessä");
    expect(plan.prepared_on).toBe(TODAY);
  });

  it("asukas ei näe luonnosta eikä suunnitelmariviä", async () => {
    expect(await db.asUser(residentA.sub, (tx) => tx.query("select id from er_rescue_plans"))).toEqual([]);
  });

  it("valmiiksi merkitty versio: dokumentti asukkaille, tehtävä vuosikelloon", async () => {
    const result = await db.asUser(f.managerA.sub, (tx) => finalizeDraft(tx, { planId: draftId, userId: f.managerA.id, document: fakeDocument("Pelastussuunnitelma v1") }));
    firstDocumentId = result.documentId;
    firstTaskId = result.taskId;
    expect(result.supersededId).toBeNull();

    const doc = await db.asService((tx) => one<{ category: string; visibility: string; year: number }>(tx, "select category, visibility, year from er_documents where id = $1", [firstDocumentId]));
    expect(doc).toEqual({ category: "rescue_plan", visibility: "residents", year: 2026 });

    // Asukkaille tiedoteluonnos, jota ei julkaista automaattisesti eikä näytetä portaalissa.
    expect(result.announcementId).not.toBeNull();
    const notice = await db.asService((tx) =>
      one<{ status: string; audience_roles: string[]; title: string }>(tx, "select status, audience_roles, title from er_announcements where id = $1", [result.announcementId]),
    );
    expect(notice).toEqual({ status: "draft", audience_roles: ["owner", "resident"], title: "Taloyhtiön pelastussuunnitelma on päivitetty" });
    const seenByResident = await db.asUser(residentA.sub, (tx) => tx.query("select id from er_announcements where id = $1", [result.announcementId]));
    expect(seenByResident).toHaveLength(0);

    const task = await db.asService((tx) =>
      one<{ title: string; category: string; due_on: string; template_key: string; assignee_user_id: string; recurrence: { freq: string } }>(
        tx, "select title, category, to_char(due_on, 'YYYY-MM-DD') as due_on, template_key, assignee_user_id, recurrence from er_tasks where id = $1", [firstTaskId],
      ),
    );
    expect(task).toMatchObject({ title: "Pelastussuunnitelman tarkistus", category: "safety", due_on: "2027-09-15", template_key: REVIEW_TASK_KEY, assignee_user_id: f.managerA.id });
    expect(task.recurrence.freq).toBe("yearly");

    // Asukas näkee valmiin suunnitelman dokumenttina, toisen organisaation asukas ei.
    expect(await db.asUser(residentA.sub, (tx) => tx.query("select id from er_documents where id = $1", [firstDocumentId]))).toHaveLength(1);
    expect(await db.asUser(residentB.sub, (tx) => tx.query("select id from er_documents where id = $1", [firstDocumentId]))).toEqual([]);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_documents where id = $1", [firstDocumentId]))).toEqual([]);

    const status = await db.asUser(f.managerA.sub, async (tx) => {
      const company = await one<{ id: string; organization_id: string; htj_synced_at: string | null }>(tx, "select id, organization_id, htj_synced_at from er_housing_companies where id = $1", [f.companyA]);
      return loadCompanyModuleStatus(tx, company, TODAY);
    });
    expect(status.pelastussuunnitelma).toMatchObject({ tone: "ok" });
  });

  it("valmista versiota ei voi muuttaa eikä poistaa", async () => {
    await expect(
      db.asUser(f.managerA.sub, (tx) => tx.query("update er_rescue_plans set content = '{}' where id = $1", [draftId])),
    ).rejects.toThrow(/Valmista pelastussuunnitelman versiota ei voi muuttaa/);
    expect(await db.asUser(f.managerA.sub, (tx) => deleteDraft(tx, { planId: draftId, userId: f.managerA.id }))).toBe(false);
    expect(await db.asUser(f.managerA.sub, (tx) => listPlans(tx, f.companyA))).toHaveLength(1);
  });

  it("uusi versio korvaa edellisen; vanha säilyy ja sen PDF muuttuu sisäiseksi, tehtävä siirtyy", async () => {
    const second = await db.asUser(f.managerA.sub, async (tx) => {
      const { current } = currentAndDraft(await listPlans(tx, f.companyA));
      const created = await createDraft(tx, { organizationId: f.orgA, companyId: f.companyA, userId: f.managerA.id, content: current!.content, visibility: current!.visibility });
      await saveDraft(tx, { planId: created.id, userId: f.managerA.id, content: current!.content, preparedOn: "2027-08-01", nextReviewOn: "2028-08-01", visibility: "residents" });
      return created.id;
    });
    const result = await db.asUser(f.managerA.sub, (tx) => finalizeDraft(tx, { planId: second, userId: f.managerA.id, document: fakeDocument("Pelastussuunnitelma v2") }));
    expect(result.supersededId).toBe(draftId);
    expect(result.taskId).toBe(firstTaskId);

    const plans = await db.asUser(f.managerA.sub, (tx) => listPlans(tx, f.companyA));
    expect(plans.map((p) => [p.version, p.status, Boolean(p.superseded_at)])).toEqual([
      [2, "final", false],
      [1, "final", true],
    ]);
    expect(plans[1].content.assemblyPoint).toBe("Jätekatoksen edessä");

    const oldDoc = await db.asService((tx) => one<{ visibility: string }>(tx, "select visibility from er_documents where id = $1", [firstDocumentId]));
    expect(oldDoc.visibility).toBe("internal");
    expect(await db.asUser(residentA.sub, (tx) => tx.query("select id from er_documents where id = $1", [firstDocumentId]))).toEqual([]);
    expect(await db.asUser(residentA.sub, (tx) => tx.query("select id from er_documents where id = $1", [result.documentId]))).toHaveLength(1);

    const task = await db.asService((tx) => one<{ due_on: string; open: number }>(tx,
      `select to_char(due_on, 'YYYY-MM-DD') as due_on,
              (select count(*)::int from er_tasks where company_id = $2 and template_key = $3 and done_at is null) as open
         from er_tasks where id = $1`, [firstTaskId, f.companyA, REVIEW_TASK_KEY]));
    expect(task).toEqual({ due_on: "2028-08-01", open: 1 });

    // Korvattua versiota ei voi palauttaa voimaan.
    await expect(
      db.asUser(f.managerA.sub, (tx) => tx.query("update er_rescue_plans set superseded_at = null where id = $1", [draftId])),
    ).rejects.toThrow();
  });

  it("yhtiöllä on kerrallaan vain yksi luonnos ja yksi voimassa oleva versio", async () => {
    await db.asUser(f.managerA.sub, (tx) => tx.query("insert into er_rescue_plans (organization_id, company_id, version) values ($1,$2,3)", [f.orgA, f.companyA]));
    await expect(
      db.asUser(f.managerA.sub, (tx) => tx.query("insert into er_rescue_plans (organization_id, company_id, version) values ($1,$2,4)", [f.orgA, f.companyA])),
    ).rejects.toThrow();
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_rescue_plans (organization_id, company_id, version, status, finalized_at, prepared_on, next_review_on) values ($1,$2,5,'final',now(),'2027-01-01','2028-01-01')", [f.orgA, f.companyA]),
      ),
    ).rejects.toThrow();
  });

  it("luonnoksen voi poistaa", async () => {
    const { draft } = currentAndDraft(await db.asUser(f.managerA.sub, (tx) => listPlans(tx, f.companyA)));
    expect(await db.asUser(f.managerA.sub, (tx) => deleteDraft(tx, { planId: draft!.id, userId: f.managerA.id }))).toBe(true);
    expect(await db.asUser(f.managerA.sub, (tx) => listPlans(tx, f.companyA))).toHaveLength(2);
  });
});

describe("turvallisuustiedot rekisterissä (0108)", () => {
  it("isännöitsijä tallentaa, esitäyttö käyttää ja tyhjä kenttä ei pyyhi suunnitelman tekstiä", async () => {
    const info = safetySchema.parse({
      shelter: "own", shelter_location: "A-talon kellari", shelter_capacity: "60 henkilöä", assembly_point: "Pihan lipputanko",
      assembly_point_alt: "", shutoff_water: "Lämmönjakohuone, kellari", shutoff_electricity: "Sähköpääkeskus, A-rappu", shutoff_ventilation: "", shutoff_heating: "",
    });
    expect(info.assembly_point_alt).toBeNull();
    expect(await db.asUser(f.managerA.sub, (tx) => saveSafetyInfo(tx, { companyId: f.companyA, userId: f.managerA.id, info }))).toBe(true);
    expect((await db.asUser(f.managerA.sub, (tx) => loadSafetyInfo(tx, f.companyA)))?.shelter_location).toBe("A-talon kellari");

    const snapshot = await db.asUser(f.managerA.sub, (tx) => loadRegistrySnapshot(tx, f.companyA, TODAY));
    const content = buildPrefill(snapshot!);
    expect(content).toMatchObject({ shelter: "own", shelterLocation: "A-talon kellari", shelterCapacity: "60 henkilöä", assemblyPoint: "Pihan lipputanko", shutoffWater: "Lämmönjakohuone, kellari" });

    const edited = { ...content, assemblyPointAlt: "Naapuritalon piha", shutoffHeating: "Käsin kirjoitettu" };
    const refreshed = refreshFromRegistry(edited, snapshot!);
    expect(refreshed.assemblyPointAlt).toBe("Naapuritalon piha");
    expect(refreshed.shutoffHeating).toBe("Käsin kirjoitettu");
    expect(refreshed.shutoffElectricity).toBe("Sähköpääkeskus, A-rappu");
  });

  it("toisen organisaation isännöitsijä ei voi tallentaa", async () => {
    const info = safetySchema.parse({ shelter: "none" });
    expect(await db.asUser(f.managerB.sub, (tx) => saveSafetyInfo(tx, { companyId: f.companyA, userId: f.managerB.id, info }))).toBe(false);
  });
});
