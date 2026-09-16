import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadManagerCertificateData } from "@/lib/certificates/manager-certificate";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database } from "@/lib/db/types";
import { processNotice, submitNotice } from "@/lib/maintenance/mutations";
import type { NoticeWorkInput } from "@/lib/maintenance/notice-form";
import { getNotice, listNoticeAttachments, listNoticeWorks, listPortalNotices, listRenovationGuides } from "@/lib/maintenance/queries";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import { seedRinne, type RinneFixture } from "./htj-helpers";

/**
 * Muutostyöilmoituksen työrivit, liitteet ja ohjeen kuittaus (migraatio 0093).
 */

const works: NoticeWorkInput[] = [
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
  {
    workType: "Sähköjärjestelmä",
    description: "Kylpyhuoneen sähköt ja lattialämmitys uusitaan.",
    plannedStart: "2026-10-10",
    plannedEnd: "2026-10-20",
    contractorKind: "contractor",
    contractorName: "Sähköliike Oy",
    contractorBusinessId: null,
    contractorContact: null,
    contractorQualification: "Sähköpätevyys S1",
  },
  {
    workType: "Keittiö",
    description: "Keittiön kaapistot vaihdetaan, ei muutoksia putkiin.",
    plannedStart: null,
    plannedEnd: null,
    contractorKind: "shareholder",
    contractorName: null,
    contractorBusinessId: null,
    contractorContact: null,
    contractorQualification: null,
  },
];

let db: Database;
let f: Fixture;
let r: RinneFixture;
let noticeId: string;
let guideId: string;

async function attach(sub: string, userId: string, noticeIdArg: string, opts: { visibility?: string; category?: string; shareGroupId?: string } = {}) {
  return db.asUser(sub, (tx) =>
    tx.query(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
          visibility, subject_table, subject_id, uploaded_by)
       values ($1,$2,$3,$4,'Muutostyöilmoituksen liite','suunnitelma.pdf',$5,'application/pdf',1024,'abc',$6,'er_renovation_notices',$7,$8) returning id`,
      [f.orgA, f.companyA, opts.shareGroupId ?? r.groups["A 2"], opts.category ?? "other", `polku/${Math.random()}`, opts.visibility ?? "owners", noticeIdArg, userId],
    ),
  );
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  r = await seedRinne(db, f);
  // Yhtiön muutostyöohje dokumenttipankkiin osakkaille näkyvänä.
  guideId = (
    await db.asUser(f.managerA.sub, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, uploaded_by)
         values ($1,$2,'renovation_guide','Muutostyöohje 2026','ohje.pdf','a/ohje.pdf','application/pdf',2048,'sha','owners',$3) returning id`,
        [f.orgA, f.companyA, f.managerA.id],
      ),
    )
  ).id;
});
afterAll(async () => db.close());

describe("muutostyöilmoitus usealla työllä", () => {
  it("osakas lähettää ilmoituksen, jolla on kolme työtä ja ohjeen kuittaus", async () => {
    const guides = await db.asUser(r.users.owner.sub, (tx) => listRenovationGuides(tx, [f.companyA]));
    expect(guides.map((g) => g.id)).toEqual([guideId]);

    const submitted = await db.asUser(r.users.owner.sub, (tx) =>
      submitNotice(tx, {
        userId: r.users.owner.id,
        shareGroupId: r.groups["A 2"],
        description: "Kylpyhuoneen ja keittiön remontti.",
        works,
        guideDocumentId: guides[0].id,
        guideAcknowledged: true,
        notifyEmail: true,
        notifySms: true,
      }),
    );
    noticeId = submitted.id;
    expect(submitted).toMatchObject({ organizationId: f.orgA, companyId: f.companyA, shareGroupId: r.groups["A 2"] });

    const rows = await db.asUser(r.users.owner.sub, (tx) => listNoticeWorks(tx, noticeId));
    expect(rows.map((w) => [w.sort_order, w.work_type])).toEqual([[1, "Märkätilat"], [2, "Sähköjärjestelmä"], [3, "Keittiö"]]);
    expect(rows[0]).toMatchObject({ contractor_kind: "contractor", contractor_name: "Remonttipalvelu Oy", contractor_business_id: "1234567-1" });
    expect(rows[2]).toMatchObject({ contractor_kind: "shareholder", contractor_name: null, contractor_qualification: null });

    const notice = await db.asUser(f.managerA.sub, (tx) => getNotice(tx, noticeId));
    expect(notice).toMatchObject({ work_count: 3, guide_document_id: guideId, notify_email: true, notify_sms: true });
    expect(notice!.guide_acknowledged_at).not.toBeNull();
    // Yhteenveto listoille: työlajit ja aikaväli tulevat työriveiltä.
    expect(notice!.work_types?.split(", ").sort()).toEqual(["Keittiö", "Märkätilat", "Sähköjärjestelmä"]);
    expect([notice!.works_start, notice!.works_end]).toEqual(["2026-10-01", "2026-11-15"]);
  });

  it("työriviä ei voi lisätä toisen osakkaan ilmoitukseen", async () => {
    await expect(
      db.asUser(r.users.veera.sub, (tx) =>
        tx.query(
          "insert into er_renovation_notice_works (organization_id, notice_id, sort_order, work_type, description, contractor_kind) values ($1,$2,9,'Keittiö','Lisätty luvatta','shareholder')",
          [f.orgA, noticeId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("toinen osakas ei näe työrivejä, hallitus ja henkilökunta näkevät", async () => {
    expect(await db.asUser(r.users.veera.sub, (tx) => listNoticeWorks(tx, noticeId))).toHaveLength(0);
    expect(await db.asUser(r.users.chair.sub, (tx) => listNoticeWorks(tx, noticeId))).toHaveLength(3);
    expect(await db.asUser(f.managerA.sub, (tx) => listNoticeWorks(tx, noticeId))).toHaveLength(3);
  });

  it("toisen organisaation isännöitsijä ei näe työrivejä", async () => {
    const rows = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_renovation_notice_works"));
    expect(rows).toHaveLength(0);
  });

  it("portaalin lista kertoo työrivien määrän ja tilan", async () => {
    const [row] = await db.asUser(r.users.owner.sub, (tx) => listPortalNotices(tx));
    expect(row).toMatchObject({ work_count: 3, status: "received" });
  });
});

describe("muutostyöilmoituksen liitteet", () => {
  it("osakas liittää tiedoston omaan ilmoitukseensa", async () => {
    await attach(r.users.owner.sub, r.users.owner.id, noticeId);
    expect(await db.asUser(r.users.owner.sub, (tx) => listNoticeAttachments(tx, noticeId))).toHaveLength(1);
  });

  it("liite näkyy hallitukselle ja henkilökunnalle, ei toiselle osakkaalle eikä toiselle organisaatiolle", async () => {
    expect(await db.asUser(r.users.chair.sub, (tx) => listNoticeAttachments(tx, noticeId))).toHaveLength(1);
    expect(await db.asUser(f.managerA.sub, (tx) => listNoticeAttachments(tx, noticeId))).toHaveLength(1);
    expect(await db.asUser(r.users.veera.sub, (tx) => listNoticeAttachments(tx, noticeId))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => listNoticeAttachments(tx, noticeId))).toHaveLength(0);
  });

  it("osakas ei voi liittää sisäistä dokumenttia eikä liitettä toisen ilmoitukseen", async () => {
    await expect(attach(r.users.owner.sub, r.users.owner.id, noticeId, { visibility: "internal" })).rejects.toThrow(/row-level security/);
    await expect(attach(r.users.veera.sub, r.users.veera.id, noticeId, { shareGroupId: r.groups["A 3"] })).rejects.toThrow(/row-level security/);
  });

  it("ilmoituksen liite ei näy dokumenttipankissa, koska se on sidottu kohteeseen", async () => {
    const bank = await db.asUser(f.managerA.sub, (tx) =>
      tx.query<{ id: string }>("select id from er_documents where subject_table is null and company_id = $1", [f.companyA]),
    );
    expect(bank.map((d) => d.id)).toEqual([guideId]);
  });
});

describe("muutostyön valmistuminen", () => {
  it("jokaisesta työrivistä tulee oma rivi korjaushistoriaan", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      processNotice(tx, { id: noticeId, userId: f.managerA.id, today: "2026-09-20", update: { status: "approved", conditions: null, supervisor: null, decidedOn: null, completedOn: null } }),
    );
    await db.asUser(f.managerA.sub, (tx) =>
      processNotice(tx, { id: noticeId, userId: f.managerA.id, today: "2026-11-20", update: { status: "completed", conditions: null, supervisor: null, decidedOn: null, completedOn: "2026-11-20" } }),
    );
    const history = await db.asService((tx) =>
      tx.query<{ work_type: string; performed_by: string; source: string; completed_year: number }>(
        `select w.work_type, w.performed_by, w.source, w.completed_year from er_renovation_notice_works rw
           join er_maintenance_works w on w.id = rw.maintenance_work_id where rw.notice_id = $1 order by rw.sort_order`,
        [noticeId],
      ),
    );
    expect(history.map((w) => w.work_type)).toEqual(["Märkätilat", "Sähköjärjestelmä", "Keittiö"]);
    expect(history.every((w) => w.performed_by === "shareholder" && w.source === "renovation_notice" && w.completed_year === 2026)).toBe(true);
    const notice = await db.asUser(f.managerA.sub, (tx) => getNotice(tx, noticeId));
    expect(notice!.maintenance_work_id).not.toBeNull();
  });

  it("isännöitsijäntodistus näyttää ilmoituksen työlajit työriveiltä", async () => {
    const data = await db.asUser(f.managerA.sub, (tx) => loadManagerCertificateData(tx, r.groups["A 2"], { issuedOn: "2026-11-21" }));
    expect(data).not.toBeNull();
    const row = data!.renovationNotices[0];
    expect(row.status).toBe("Valmis");
    expect(row.work.split(", ").sort()).toEqual(["Keittiö", "Märkätilat", "Sähköjärjestelmä"]);
  });
});

describe("ilmoitustapa", () => {
  it("ilman sähköpostivalintaa tilamuutoksesta ei lähde viestiä osakkaalle", async () => {
    const submitted = await db.asUser(r.users.veera.sub, (tx) =>
      submitNotice(tx, {
        userId: r.users.veera.id,
        shareGroupId: r.groups["A 3"],
        description: "Keittiön kaapistojen vaihto.",
        works: [works[2]],
        guideAcknowledged: true,
        notifyEmail: false,
        notifySms: false,
      }),
    );
    await db.asUser(f.managerA.sub, (tx) =>
      processNotice(tx, { id: submitted.id, userId: f.managerA.id, today: "2026-09-20", update: { status: "approved", conditions: null, supervisor: null, decidedOn: null, completedOn: null } }),
    );
    const msgs = await db.asService((tx) =>
      tx.query<{ recipient: string }>("select recipient from er_outbound_messages where subject_id = $1", [submitted.id]),
    );
    // Vain ilmoitus isännöitsijälle, ei tilamuutosviestiä osakkaalle.
    expect(msgs.map((m) => m.recipient)).not.toContain("veera@example.test");
  });
});

describe("migraatio 0093: vanhat ilmoitukset", () => {
  it("vanha yhden työn ilmoitus siirtyy työriviksi tietoa menettämättä", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, process.cwd(), "0092_rescue_plans.sql");
      const of = await seedTwoOrgs(old);
      const seeded = await old.asService(async (tx) => {
        const g = await one<{ id: string }>(
          tx,
          "insert into er_share_groups (organization_id, company_id, unit_label, kind, source) values ($1,$2,'B 1','apartment','manual') returning id",
          [of.orgA, of.companyA],
        );
        const n = await one<{ id: string }>(
          tx,
          `insert into er_renovation_notices (organization_id, company_id, share_group_id, description, work_type, planned_start, planned_end, status)
           values ($1,$2,$3,'Vanha ilmoitus: saunan uusiminen','Märkätilat','2025-03-01','2025-04-15','approved') returning id`,
          [of.orgA, of.companyA, g.id],
        );
        // Ilmoitus ilman työlajia ja päivämääriä: migraation pitää kestää sekin.
        const bare = await one<{ id: string }>(
          tx,
          "insert into er_renovation_notices (organization_id, company_id, share_group_id, description) values ($1,$2,$3,'Vanha ilmoitus ilman työlajia') returning id",
          [of.orgA, of.companyA, g.id],
        );
        return { noticeId: n.id, bareId: bare.id };
      });

      const ran = await migrateLocal(old);
      expect(ran).toContain("0093_renovation_notice_works.sql");

      const rows = await old.asService((tx) =>
        tx.query<{ work_type: string; description: string; planned_start: string | null; planned_end: string | null; contractor_kind: string; sort_order: number }>(
          "select work_type, description, planned_start::text, planned_end::text, contractor_kind, sort_order from er_renovation_notice_works where notice_id = $1",
          [seeded.noticeId],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        work_type: "Märkätilat",
        description: "Vanha ilmoitus: saunan uusiminen",
        planned_start: "2025-03-01",
        planned_end: "2025-04-15",
        contractor_kind: "unknown",
        sort_order: 1,
      });

      const bare = await old.asService((tx) =>
        tx.query<{ work_type: string; planned_start: string | null }>(
          "select work_type, planned_start::text from er_renovation_notice_works where notice_id = $1",
          [seeded.bareId],
        ),
      );
      expect(bare).toEqual([{ work_type: "Muu", planned_start: null }]);

      // Vanha ilmoitus näkyy uusissa kyselyissä työriveineen.
      const notice = await old.asUser(of.managerA.sub, (tx) => getNotice(tx, seeded.noticeId));
      expect(notice).toMatchObject({ work_count: 1, work_types: "Märkätilat", notify_email: true, notify_sms: false, guide_acknowledged_at: null });
    } finally {
      await old.close();
    }
  });
});
