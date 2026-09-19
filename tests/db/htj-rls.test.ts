import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import { seedRinne, type RinneFixture } from "./htj-helpers";
import type { Database } from "@/lib/db/types";
import { createMockHtjClient } from "@/lib/htj/mock";
import { runFetchSync } from "@/lib/htj/sync";
import { prepareDraft } from "@/lib/htj/submissions";
import { processNotice, submitNotice } from "@/lib/maintenance/mutations";
import { listPortalNotices } from "@/lib/maintenance/queries";

let db: Database;
let f: Fixture;
let r: RinneFixture;
let noticeId: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  r = await seedRinne(db, f);
  await db.asService((tx) =>
    tx.query("insert into er_charge_bases (organization_id, company_id, charge_type, basis, unit_price, starts_on, htj_charge_type) values ($1,$2,'maintenance','area_m2',3,'2025-01-01','hoitovastike')", [f.orgA, f.companyA]),
  );
  await db.asUser(f.managerA.sub, (tx) => runFetchSync(tx, createMockHtjClient(), { companyId: f.companyA, userId: f.managerA.id }));
  await db.asUser(f.accountantA.sub, (tx) => prepareDraft(tx, { companyId: f.companyA, kind: "charges", userId: f.accountantA.id }));
});
afterAll(async () => db.close());

describe("HTJ-taulujen organisaatioeristys", () => {
  it("toinen organisaatio ei näe synkronointeja, eroja, ilmoituksia eikä hakulokia", async () => {
    for (const t of ["er_htj_syncs", "er_htj_diffs", "er_htj_submissions", "er_htj_requests"]) {
      const rows = await db.asUser(f.managerB.sub, (tx) => tx.query(`select id from ${t}`));
      expect(rows, t).toHaveLength(0);
    }
    const own = await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_htj_diffs"));
    expect(own.length).toBeGreaterThan(0);
  });

  it("toinen organisaatio ei voi hyväksyä eroja eikä ilmoituksia", async () => {
    const d = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_htj_diffs set status = 'accepted' returning id"));
    expect(d).toHaveLength(0);
    const s = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_htj_submissions set status = 'approved', approved_by = $1 returning id", [f.managerB.id]));
    expect(s).toHaveLength(0);
  });

  it("kirjanpitäjä ei käynnistä hakua eikä näe hakulokia", async () => {
    await expect(
      db.asUser(f.accountantA.sub, (tx) => tx.query("insert into er_htj_syncs (organization_id, company_id, kind, target) values ($1,$2,'fetch','company')", [f.orgA, f.companyA])),
    ).rejects.toThrow(/row-level security/);
    const log = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_htj_requests"));
    expect(log).toHaveLength(0);
    const upd = await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_htj_diffs set status = 'accepted' returning id"));
    expect(upd).toHaveLength(0);
  });

  it("hakulokia ei voi muuttaa eikä kirjoittaa toisen nimissä", async () => {
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("delete from er_htj_requests"))).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_htj_requests (organization_id, user_id, operation, purpose, mode, outcome) values ($1,$2,'owners','registry_sync','mock','ok')", [f.orgA, f.accountantA.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("portaalikäyttäjä ei näe HTJ-tauluja", async () => {
    for (const t of ["er_htj_syncs", "er_htj_diffs", "er_htj_submissions", "er_htj_requests"]) {
      const rows = await db.asUser(r.users.chair.sub, (tx) => tx.query(`select id from ${t}`));
      expect(rows, t).toHaveLength(0);
    }
  });
});

describe("muutostyöilmoitukset portaalissa", () => {
  it("osakas tekee ilmoituksen omasta huoneistostaan ja viesti menee isännöitsijälle", async () => {
    const submitted = await db.asUser(r.users.owner.sub, (tx) =>
      submitNotice(tx, {
        userId: r.users.owner.id,
        shareGroupId: r.groups["A 2"],
        description: "Kylpyhuoneen remontti",
        guideAcknowledged: true,
        works: [
          {
            workType: "Märkätilat",
            description: "Kylpyhuoneen vedeneristys ja laatoitus uusitaan.",
            plannedStart: "2026-10-01",
            plannedEnd: "2026-11-15",
            contractorKind: "contractor",
            contractorName: "Remonttipalvelu Oy",
            contractorBusinessId: "1234567-1",
            contractorContact: "Työnjohtaja 040 111 2222",
            contractorQualification: "Sertifioitu vedeneristäjä",
          },
        ],
      }),
    );
    noticeId = submitted.id;
    const msgs = await db.asService((tx) => tx.query<{ recipient: string; subject: string; body: string }>("select recipient, subject, body from er_outbound_messages where subject_id = $1", [noticeId]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].subject).toMatch(/A 2/);
    expect(msgs[0].body).not.toMatch(/Olli|olli@|Kylpyhuone/);
    const [mgr] = await db.asService((tx) => tx.query<{ email: string }>("select email from er_users where id = $1", [f.managerA.id]));
    expect(msgs[0].recipient).toBe(mgr.email);
  });

  it("osakas ei voi tehdä ilmoitusta toisen huoneistosta", async () => {
    await expect(
      db.asUser(r.users.owner.sub, (tx) =>
        tx.query(
          "insert into er_renovation_notices (organization_id, company_id, share_group_id, submitted_by_user_id, description) values ($1,$2,$3,$4,'x')",
          [f.orgA, f.companyA, r.groups["A 1"], r.users.owner.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("viestifunktio ei hyväksy toisen ilmoitusta", async () => {
    await expect(db.asUser(r.users.chair.sub, (tx) => tx.query("select er_notify_renovation_notice($1)", [noticeId]))).rejects.toThrow();
  });

  it("osakas näkee vain omat, hallitus näkee yhtiön ilmoitukset", async () => {
    // Olli omistaa A 2:n, Veera A 3:n. Paula omistaa A 1:n ja on hallituksen puheenjohtaja.
    const own = await db.asUser(r.users.owner.sub, (tx) => listPortalNotices(tx));
    expect(own.map((n) => n.id)).toEqual([noticeId]);
    expect(own[0].unit_label).toBe("A 2");
    const other = await db.asUser(r.users.veera.sub, (tx) => listPortalNotices(tx));
    expect(other).toHaveLength(0);
    const board = await db.asUser(r.users.chair.sub, (tx) => listPortalNotices(tx));
    expect(board.map((n) => n.id)).toEqual([noticeId]);
    const orgB = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_renovation_notices"));
    expect(orgB).toHaveLength(0);
  });

  it("valmistunut muutostyö siirtyy korjaushistoriaan osakkaan tekemänä", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      processNotice(tx, { id: noticeId, userId: f.managerA.id, today: "2026-09-15", update: { status: "approved_with_conditions", conditions: "Vedeneristys sertifioidulla tekijällä", supervisor: "Esimerkkivalvonta Oy", supervisionCostEur: null, supervisionCostBasis: null, decidedOn: null, completedOn: null } }),
    );
    await db.asUser(f.managerA.sub, (tx) =>
      processNotice(tx, { id: noticeId, userId: f.managerA.id, today: "2026-11-20", update: { status: "completed", conditions: "Vedeneristys sertifioidulla tekijällä", supervisor: "Esimerkkivalvonta Oy", supervisionCostEur: null, supervisionCostBasis: null, decidedOn: null, completedOn: "2026-11-20" } }),
    );
    const [dates] = await db.asService((tx) => tx.query<{ decided_on: string; completed_on: string }>("select decided_on::text, completed_on::text from er_renovation_notices where id = $1", [noticeId]));
    expect(dates).toEqual({ decided_on: "2026-09-15", completed_on: "2026-11-20" });
    const work = await db.asService((tx) =>
      one<{ performed_by: string; source: string; work_type: string; completed_year: number; share_group_id: string }>(tx,
        "select w.performed_by, w.source, w.work_type, w.completed_year, w.share_group_id from er_renovation_notices n join er_maintenance_works w on w.id = n.maintenance_work_id where n.id = $1", [noticeId]),
    );
    expect(work).toMatchObject({ performed_by: "shareholder", source: "renovation_notice", work_type: "Märkätilat", completed_year: 2026, share_group_id: r.groups["A 2"] });
    const msgs = await db.asService((tx) => tx.query<{ recipient: string }>("select recipient from er_outbound_messages where subject_id = $1 and recipient = 'olli@example.test'", [noticeId]));
    expect(msgs).toHaveLength(2);
    // Osakas näkee oman huoneistonsa korjaushistorian.
    const visible = await db.asUser(r.users.owner.sub, (tx) => tx.query("select id from er_maintenance_works where share_group_id = $1", [r.groups["A 2"]]));
    expect(visible).toHaveLength(1);
  });

  it("valmista ilmoitusta ei voi palauttaa käsittelyyn", async () => {
    await expect(
      db.asUser(f.managerA.sub, (tx) => processNotice(tx, { id: noticeId, userId: f.managerA.id, today: "2026-11-21", update: { status: "received", conditions: null, supervisor: null, supervisionCostEur: null, supervisionCostBasis: null, decidedOn: null, completedOn: null } })),
    ).rejects.toThrow(/ei voi siirtyä/);
  });
});
