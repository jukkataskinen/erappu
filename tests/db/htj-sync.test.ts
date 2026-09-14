import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";
import { seedRinne, type RinneFixture } from "./htj-helpers";
import type { Database } from "@/lib/db/types";
import { createMockHtjClient } from "@/lib/htj/mock";
import { decideDiffs, runChangeSync, runFetchSync } from "@/lib/htj/sync";
import { approveSubmission, markManualDone, prepareDraft, sendSubmission, SubmissionError } from "@/lib/htj/submissions";
import { companyHtjOverview } from "@/lib/htj/queries";

let db: Database;
let f: Fixture;
let r: RinneFixture;
const client = createMockHtjClient();
let TODAY = "";

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  r = await seedRinne(db, f);
  TODAY = (await db.asService((tx) => tx.query<{ d: string }>("select current_date::text as d")))[0].d;
});
afterAll(async () => db.close());

const asManager = <T>(fn: Parameters<Database["asUser"]>[1]) => db.asUser(f.managerA.sub, fn) as Promise<T>;

describe("HTJ-synkronointi mock-asiakkaalla", () => {
  it("haku tuottaa erot eikä muuta rekisteriä", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => runFetchSync(tx, client, { companyId: f.companyA, userId: f.managerA.id }));
    expect(res.status).toBe("warnings");
    const diffs = await asManager<{ entity: string; action: string; label: string }[]>((tx) =>
      tx.query("select entity, action, label from er_htj_diffs where company_id = $1 and status = 'pending' order by sort_order, label", [f.companyA]),
    );
    const kinds = diffs.map((d) => `${d.entity}:${d.action}`);
    expect(kinds).toContain("ownership:remove"); // Veera
    expect(kinds.filter((k) => k === "ownership:add")).toHaveLength(2); // Toivo, Maija
    expect(diffs.some((d) => /A 4: omistajan Matti Meikäläinen osuus koko → 1\/2/.test(d.label))).toBe(true);
    expect(kinds.filter((k) => k === "share_group:update")).toHaveLength(4); // linkitys HTJ:hin

    const [company] = await asManager<{ htj_synced_at: string | null }[]>((tx) => tx.query("select htj_synced_at from er_housing_companies where id = $1", [f.companyA]));
    expect(company.htj_synced_at).toBeNull();
    const [veera] = await asManager<{ ends_on: string | null }[]>((tx) => tx.query("select ends_on from er_ownerships where id = $1", [r.ownerships["A 3"]]));
    expect(veera.ends_on).toBeNull();
  });

  it("jokainen haku kirjataan lokiin ilman henkilötietoja", async () => {
    const rows = await db.asService((tx) => tx.query<Record<string, unknown>>("select * from er_htj_requests where company_id = $1 order by created_at", [f.companyA]));
    expect(rows.map((x) => x.operation)).toEqual(["company", "share_groups", "owners", "restrictions"]);
    expect(rows.find((x) => x.operation === "owners")).toMatchObject({ scope: "narrow", purpose: "registry_sync", user_id: f.managerA.id, outcome: "ok", mode: "mock" });
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/Toivo|Testinen|1990-06-30|TESTI-/);
    const diffs = await db.asService((tx) => tx.query("select before, after from er_htj_diffs where company_id = $1", [f.companyA]));
    expect(JSON.stringify(diffs)).not.toMatch(/1990-06-30|1961-09-09|TESTI-/);
  });

  it("kirjanpitäjä ei voi hyväksyä eroja", async () => {
    // RLS ei päästä kirjanpitäjää rekisteriin: ensimmäinen ero kaatuu ja koko erä perutaan.
    await expect(
      db.asUser(f.accountantA.sub, (tx) => decideDiffs(tx, { companyId: f.companyA, diffIds: "all", decision: "accept", userId: f.accountantA.id })),
    ).rejects.toThrow();
    const [n] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from er_htj_diffs where company_id = $1 and status = 'accepted'", [f.companyA]));
    expect(n.n).toBe(0);
    // Hylkäyskään ei mene läpi: erojen tilaa ei voi muuttaa.
    await db.asUser(f.accountantA.sub, (tx) => decideDiffs(tx, { companyId: f.companyA, diffIds: "all", decision: "reject", userId: f.accountantA.id }));
    const [p] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from er_htj_diffs where company_id = $1 and status = 'pending'", [f.companyA]));
    expect(p.n).toBeGreaterThan(0);
  });

  it("hyväksyntä kirjoittaa omistajanvaihdoksen, murto-osuudet ja portaalioikeudet", async () => {
    const result = await db.asUser(f.managerA.sub, (tx) => decideDiffs(tx, { companyId: f.companyA, diffIds: "all", decision: "accept", userId: f.managerA.id }));
    expect(result.remaining).toBe(0);

    const owners = await db.asService((tx) =>
      tx.query<{ unit_label: string; display_name: string; share_numerator: number; share_denominator: number; source: string; htj_id: string | null; ends_on: string | null }>(
        `select g.unit_label, p.display_name, o.share_numerator, o.share_denominator, o.source, o.htj_id, o.ends_on::text
           from er_ownerships o join er_share_groups g on g.id = o.share_group_id join er_parties p on p.id = o.party_id
          where g.company_id = $1 order by g.unit_label, p.display_name`,
        [f.companyA],
      ),
    );
    const active = owners.filter((o) => !o.ends_on || o.ends_on >= TODAY);
    expect(active.map((o) => `${o.unit_label} ${o.display_name} ${o.share_numerator}/${o.share_denominator} ${o.source}`)).toEqual([
      "A 1 Paula Puheenjohtaja 1/1 htj",
      "A 2 Olli Osakas 1/1 htj",
      "A 3 Toivo Testinen 1/1 htj",
      "A 4 Maija Meikäläinen 1/2 htj",
      "A 4 Matti Meikäläinen 1/2 htj",
    ]);
    expect(owners.find((o) => o.display_name === "Veera Vuokranantaja")!.ends_on).not.toBeNull();

    // Turvakiellon alaisen omistajan osoitetta ei tallenneta.
    const [maija] = await db.asService((tx) => tx.query<{ street_address: string | null; htj_id: string | null }>("select street_address, htj_id from er_parties where last_name = 'Meikäläinen' and first_names = 'Maija'"));
    expect(maija.street_address).toBeNull();
    expect(maija.htj_id).toBeTruthy();

    // Veeran portaalioikeus päättyi, ja yhtiö on synkronoitu.
    const veeraAccess = await db.asService((tx) =>
      tx.query<{ ends_on: string | null }>("select ends_on::text from er_portal_access where user_id = $1 and role = 'owner'", [r.users.veera.id]),
    );
    expect(veeraAccess).toHaveLength(1);
    expect(veeraAccess[0].ends_on).not.toBeNull();
    const [company] = await db.asService((tx) => tx.query<{ htj_synced_at: string | null; htj_id: string | null }>("select htj_synced_at, htj_id from er_housing_companies where id = $1", [f.companyA]));
    expect(company.htj_synced_at).not.toBeNull();
    expect(company.htj_id).toBe("HTJ-YHT-1000000-9");
    const groups = await db.asService((tx) => tx.query<{ source: string; htj_id: string }>("select source, htj_id from er_share_groups where company_id = $1", [f.companyA]));
    expect(groups.every((g) => g.source === "htj" && g.htj_id)).toBe(true);
  });

  it("uusi haku täsmää eikä tuota eroja", async () => {
    const res = await db.asUser(f.managerA.sub, (tx) => runFetchSync(tx, client, { companyId: f.companyA, userId: f.managerA.id }));
    expect(res).toMatchObject({ status: "ok", diffCount: 0 });
  });

  it("muutostietojen yöajo tekee erot omistajanvaihdoksesta", async () => {
    const a2 = client.dataset.companies[0].owners.find((o) => o.name === "Olli Osakas")!;
    a2.htjId = "1000000-9-OM-900";
    a2.ownerRef = "1000000-9-HLO-KUVITELMA-SANTERI";
    a2.name = "Santeri Kuvitelma";
    a2.firstNames = "Santeri";
    a2.lastName = "Kuvitelma";
    client.dataset.changes.push({ htjId: "MUUTOS-9", businessId: "1000000-9", kind: "ownership", shareGroupHtjId: a2.shareGroupHtjId, occurredAt: "2026-09-14T22:00:00Z" });

    const result = await runChangeSync(db, client, { since: new Date("2026-09-14T00:00:00Z") });
    expect(result).toMatchObject({ organizations: 1, changes: 1, companies: 1, errors: 0 });
    const diffs = await db.asService((tx) => tx.query<{ label: string; action: string }>("select label, action from er_htj_diffs where company_id = $1 and status = 'pending' order by sort_order", [f.companyA]));
    expect(diffs.map((d) => d.action)).toEqual(["remove", "add"]);
    const log = await db.asService((tx) => tx.query<{ user_id: string | null; purpose: string }>("select user_id, purpose from er_htj_requests where operation = 'changes'"));
    expect(log[0]).toMatchObject({ user_id: null, purpose: "change_sync" });

    // Hylkäys päättää käsittelyn muuttamatta rekisteriä.
    await db.asUser(f.managerA.sub, (tx) => decideDiffs(tx, { companyId: f.companyA, diffIds: "all", decision: "reject", userId: f.managerA.id }));
    const [olli] = await db.asService((tx) => tx.query<{ ends_on: string | null }>("select ends_on from er_ownerships where id = $1", [r.ownerships["A 2"]]));
    expect(olli.ends_on).toBeNull();
  });

  it("yhtiö, jota ei ole HTJ:ssä, merkitään virheeksi ja loki säilyy", async () => {
    const res = await db.asUser(f.managerB.sub, (tx) => runFetchSync(tx, client, { companyId: f.companyB, userId: f.managerB.id }));
    expect(res.status).toBe("error");
    const rows = await db.asService((tx) => tx.query<{ outcome: string }>("select outcome from er_htj_requests where company_id = $1", [f.companyB]));
    expect(rows.map((x) => x.outcome)).toEqual(["not_found"]);
  });
});

describe("HTJ2-ilmoitusjono", () => {
  beforeAll(async () => {
    await db.asService(async (tx) => {
      await tx.query(
        `insert into er_charge_bases (organization_id, company_id, charge_type, basis, unit_price, starts_on, decided_on, htj_charge_type)
         values ($1,$2,'maintenance','area_m2',3.00,'2025-07-01','2025-04-20','hoitovastike')`,
        [f.orgA, f.companyA],
      );
      const [loan] = await tx.query<{ id: string }>(
        "insert into er_loans (organization_id, company_id, name, principal_eur, balance_eur, balance_date) values ($1,$2,'Kattolaina',120000,96000,'2025-12-31') returning id",
        [f.orgA, f.companyA],
      );
      for (const gid of Object.values(r.groups)) {
        await tx.query("insert into er_loan_shares (organization_id, loan_id, share_group_id, original_eur, remaining_eur, balance_date) values ($1,$2,$3,30000,24000,'2025-12-31')", [f.orgA, loan.id, gid]);
      }
      await tx.query("insert into er_maintenance_works (organization_id, company_id, project, work_type, completed_year) values ($1,$2,'Vesikaton uusiminen','Vesikatto',2024)", [f.orgA, f.companyA]);
    });
  });

  it("velvollisuus ja tila yhteenvedossa", async () => {
    const o = await db.asUser(f.managerA.sub, (tx) => companyHtjOverview(tx, f.companyA, TODAY));
    expect(o!.obligation.level).toBe("mandatory");
    expect(o!.state).toBe("not_started");
    expect(o!.gaps.some((g) => g.area === "maintenance_needs")).toBe(true);
  });

  it("kirjanpitäjä valmistelee, mutta ei hyväksy eikä lähetä", async () => {
    const id = await db.asUser(f.accountantA.sub, (tx) => prepareDraft(tx, { companyId: f.companyA, kind: "charges", userId: f.accountantA.id, today: TODAY }));
    await expect(db.asUser(f.accountantA.sub, (tx) => approveSubmission(tx, { id, userId: f.accountantA.id }))).rejects.toThrow(/row-level security/);
    await expect(db.asUser(f.managerA.sub, (tx) => sendSubmission(tx, client, { id, userId: f.managerA.id }))).rejects.toBeInstanceOf(SubmissionError);
    await expect(
      db.asUser(f.accountantA.sub, (tx) => tx.query("update er_htj_submissions set status = 'approved', approved_by = $2 where id = $1", [id, f.accountantA.id])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(f.accountantA.sub, (tx) =>
        tx.query("insert into er_htj_submissions (organization_id, company_id, kind, status, approved_by) values ($1,$2,'loans','manual_done',$3)", [f.orgA, f.companyA, f.accountantA.id]),
      ),
    ).rejects.toThrow(/row-level security/);

    await db.asUser(f.managerA.sub, (tx) => approveSubmission(tx, { id, userId: f.managerA.id }));
    const sent = await db.asUser(f.managerA.sub, (tx) => sendSubmission(tx, client, { id, userId: f.managerA.id }));
    expect(sent.status).toBe("accepted");
    const [charge] = await db.asService((tx) => tx.query<{ htj_submitted_at: string | null }>("select htj_submitted_at from er_charge_bases where company_id = $1", [f.companyA]));
    expect(charge.htj_submitted_at).not.toBeNull();
    const [log] = await db.asService((tx) => tx.query<{ purpose: string }>("select purpose from er_htj_requests where operation = 'submit'"));
    expect(log.purpose).toBe("htj2_submission");
  });

  it("merkitse käsin ilmoitetuksi", async () => {
    const created = await db.asUser(f.managerA.sub, (tx) => markManualDone(tx, { companyId: f.companyA, userId: f.managerA.id, today: TODAY }));
    expect(created).toBe(3); // lainat, lainaosuudet, työt (vastikkeet jo lähetetty)
    const o = await db.asUser(f.managerA.sub, (tx) => companyHtjOverview(tx, f.companyA, TODAY));
    expect(o!.state).toBe("manual_done");
    expect(o!.unsubmitted).toBe(0);
    await expect(db.asUser(f.managerA.sub, (tx) => markManualDone(tx, { companyId: f.companyA, userId: f.managerA.id, today: TODAY }))).rejects.toThrow(/jo merkitty/);
  });
});
