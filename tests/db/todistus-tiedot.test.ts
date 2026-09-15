import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { setNeedStatus } from "@/lib/maintenance/mutations";
import { listDecidedNeeds } from "@/lib/maintenance/queries";
import { loadManagerCertificateData, renderManagerCertificate } from "@/lib/certificates/manager-certificate";

let db: Database;
let f: Fixture;
let board: { id: string; sub: string };
let groupA: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  board = await createUser(db);
  await db.asService(async (tx) => {
    groupA = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_portal_access (organization_id, user_id, company_id, role, basis) values ($1,$2,$3,'board','test')", [f.orgA, board.id, f.companyA]);
  });
});
afterAll(async () => db.close());

describe("kiinnitykset (er_property_mortgages)", () => {
  it("kirjanpitäjä lisää, toinen organisaatio ei näe eikä voi lisätä toisen yhtiöön", async () => {
    await db.asUser(f.accountantA.sub, (tx) =>
      tx.query("insert into er_property_mortgages (organization_id, company_id, amount_eur, holder) values ($1,$2,250000,'Esimerkkipankki')", [f.orgA, f.companyA]),
    );
    const own = await db.asUser(f.managerA.sub, (tx) => tx.query("select amount_eur from er_property_mortgages where company_id = $1", [f.companyA]));
    expect(own).toHaveLength(1);
    const other = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_property_mortgages"));
    expect(other).toHaveLength(0);
    await expect(
      db.asUser(f.managerB.sub, (tx) => tx.query("insert into er_property_mortgages (organization_id, company_id, amount_eur) values ($1,$2,1)", [f.orgB, f.companyA])),
    ).rejects.toThrow();
  });

  it("hallitus lukee oman yhtiönsä kiinnitykset mutta ei kirjoita", async () => {
    const rows = await db.asUser(board.sub, (tx) => tx.query("select id from er_property_mortgages"));
    expect(rows).toHaveLength(1);
    await expect(
      db.asUser(board.sub, (tx) => tx.query("insert into er_property_mortgages (organization_id, company_id, amount_eur) values ($1,$2,1)", [f.orgA, f.companyA])),
    ).rejects.toThrow();
  });
});

describe("vakuutukset (er_company_insurances)", () => {
  it("isännöitsijä lisää, kirjanpitäjä ja hallitus lukevat, toinen organisaatio ei näe", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      tx.query("insert into er_company_insurances (organization_id, company_id, insurance_type, insurer) values ($1,$2,'Kiinteistövakuutus','Esimerkkivakuutus')", [f.orgA, f.companyA]),
    );
    expect(await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_company_insurances"))).toHaveLength(1);
    expect(await db.asUser(board.sub, (tx) => tx.query("select id from er_company_insurances"))).toHaveLength(1);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_company_insurances"))).toHaveLength(0);
    await expect(
      db.asUser(f.accountantA.sub, (tx) => tx.query("insert into er_company_insurances (organization_id, company_id, insurance_type) values ($1,$2,'Muu')", [f.orgA, f.companyA])),
    ).rejects.toThrow();
  });
});

describe("todistuksen lisäsarakkeet", () => {
  it("huoneiston hallintatiedot ja rajoitteet tallentuvat, puolisoiden koti rajataan arvojoukkoon", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      tx.query(
        "update er_share_groups set company_possession = true, company_possession_decided_on = '2026-04-01', spouses_common_home = 'unknown', certificate_notes = 'Kylpyhuoneessa kosteusvaurio' where id = $1",
        [groupA],
      ),
    );
    const [g] = await db.asUser(f.managerA.sub, (tx) => tx.query<{ company_possession: boolean; spouses_common_home: string }>("select company_possession, spouses_common_home from er_share_groups where id = $1", [groupA]));
    expect(g).toMatchObject({ company_possession: true, spouses_common_home: "unknown" });
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("update er_share_groups set spouses_common_home = 'maybe' where id = $1", [groupA]))).rejects.toThrow();
  });

  it("dokumenttiluokka kunnossapitotarveselvitykselle on sallittu", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      tx.query(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256)
         values ($1,$2,'maintenance_needs_report','KPTS 2026','k.pdf','kpts/k.pdf','application/pdf',1,'x')`,
        [f.orgA, f.companyA],
      ),
    );
  });

  it("päätetyn korjauksen päätöspäivä säilyy, kun tilaa muutetaan ilman päivää", async () => {
    const needId = await db.asUser(f.managerA.sub, async (tx) =>
      (await one<{ id: string }>(tx, "insert into er_maintenance_needs (organization_id, company_id, planned_year, target, action) values ($1,$2,2027,'Katto','Uusiminen') returning id", [f.orgA, f.companyA])).id,
    );
    await db.asUser(f.managerA.sub, (tx) => setNeedStatus(tx, { id: needId, companyId: f.companyA, userId: f.managerA.id, status: "decided", decidedOn: "2026-05-10" }));
    await db.asUser(f.managerA.sub, (tx) => setNeedStatus(tx, { id: needId, companyId: f.companyA, userId: f.managerA.id, status: "in_progress" }));
    const decided = await db.asUser(f.managerA.sub, (tx) => listDecidedNeeds(tx, f.companyA));
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ status: "in_progress", decided_on: "2026-05-10" });
    expect(await db.asUser(f.managerB.sub, (tx) => listDecidedNeeds(tx, f.companyA))).toHaveLength(0);
  });
});

describe("todistuksen tietojen kokoaminen", () => {
  it("kokoaa kiinnitykset, lainaehdot, korjausten vaiheet, hallinnan ja liitteiden saatavuuden", async () => {
    await db.asService(async (tx) => {
      await tx.query(
        "update er_housing_companies set registered_on = '2007-05-02', certificate_notes = 'Yhtiöjärjestyksen muutos vireillä.', vat_registered = false, charges_decided_by = 'Yhtiökokous' where id = $1",
        [f.companyA],
      );
      await tx.query("update er_share_groups set area_m2 = 54.5, votes = 1, company_possession = true, company_possession_decided_on = '2026-04-01', company_rented = true where id = $1", [groupA]);
      await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,55)", [f.orgA, f.companyA, groupA]);
      await tx.query("insert into er_buildings (organization_id, company_id, label, completed_year, staircases, elevators, apartment_area_m2) values ($1,$2,'A',1979,2,0,450)", [f.orgA, f.companyA]);
      await tx.query(
        `insert into er_loans (organization_id, company_id, name, lender, principal_eur, balance_eur, balance_date, drawn_on, due_on, loan_type, reference_rate, margin_percent)
         values ($1,$2,'Kattolaina','Pankki',120000,96000,'2025-12-31','2023-10-31','2038-10-31','capital_charge','Euribor 12 kk',0.85),
                ($1,$2,'Limiitti','Pankki',20000,0,null,null,null,'credit_limit',null,null)`,
        [f.orgA, f.companyA],
      );
      await tx.query("insert into er_maintenance_works (organization_id, company_id, project, work_type, completed_year) values ($1,$2,'Vanha työ','Muu',1990)", [f.orgA, f.companyA]);
      await tx.query(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, year)
         values ($1,$2,'articles','Yhtiöjärjestys','yj.pdf','t/yj.pdf','application/pdf',10,'y',null)`,
        [f.orgA, f.companyA],
      );
    });
    const data = await db.asUser(f.managerA.sub, (tx) =>
      loadManagerCertificateData(tx, groupA, { issuedOn: "2026-09-15", order: { purpose: "bank", purposeText: null, ordererName: "Testi Tilaaja", withAttachments: false } }),
    );
    expect(data).not.toBeNull();
    const d = data!;
    expect(d.legalBasis).toContain("567/2026");
    expect(d.order).toEqual({ purpose: "Pankkia varten", ordererName: "Testi Tilaaja", withAttachments: false });
    expect(d.company).toMatchObject({ registeredOn: "2007-05-02", notes: "Yhtiöjärjestyksen muutos vireillä.", vat: "Ei", chargesDecidedBy: "Yhtiökokous" });
    expect(d.finance.mortgagesTotal).toBe("250 000 €");
    expect(d.finance.loans).toHaveLength(1);
    expect(d.finance.loans[0]).toMatchObject({ type: "Pääomavastikelaina", interest: "Euribor 12 kk + 0,85 %", balanceDate: "31.12.2025" });
    expect(d.finance.creditLimits).toHaveLength(1);
    expect(d.finance.insurances[0]).toMatchObject({ type: "Kiinteistövakuutus", insurer: "Esimerkkivakuutus" });
    expect(d.repairs.decided[0]).toMatchObject({ status: "Käynnissä", decidedOn: "10.5.2026" });
    // Korjaushistoria ilman 10 vuoden rajausta.
    expect(d.repairs.done.map((w) => w.year)).toContain("1990");
    expect(d.possession.companyPossession).toContain("1.4.2026");
    expect(d.possession.companyRented).toBe("Kyllä");
    expect(d.unit.notes).toBe("Kylpyhuoneessa kosteusvaurio");
    expect(d.asbestosNote).not.toBeNull();
    expect(d.attachments.find((a) => a.key === "articles")?.status).toBe("available");
    expect(d.attachments.find((a) => a.key === "budget")?.status).toBe("missing");
    const pdf = await renderManagerCertificate(d);
    expect(Buffer.from(pdf.bytes.subarray(0, 4)).toString("latin1")).toBe("%PDF");
    expect(await db.asUser(f.managerB.sub, (tx) => loadManagerCertificateData(tx, groupA))).toBeNull();
  });
});
