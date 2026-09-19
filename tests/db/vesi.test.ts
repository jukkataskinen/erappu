import { listMeteredWater } from "@/lib/consumption/queries";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { cancelBillingRun, createBillingRun, FinanceError } from "@/lib/finance/billing";
import { addChargeBasis } from "@/lib/finance/registers";
import { addMeter, createRound, createWaterSettlement, replaceMeter, reportPortalReading, saveStaffReadings, setAdvance } from "@/lib/water/mutations";
import { lastBilledReadings, portalWaterUnit } from "@/lib/water/queries";
import { attachReadingPhoto, roundPhotos } from "@/lib/water/photos";
import { queueDueReadingMessages } from "@/lib/water/notifications";

let db: Database;
let f: Fixture;
let owner1: { id: string; sub: string };
let tenant2: { id: string; sub: string };
let g1: string;
let g2: string;
let cold1: string;
let hot1: string;
let cold2: string;
let round1: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner1 = await createUser(db);
  tenant2 = await createUser(db);
  await db.asService(async (tx) => {
    g1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1',60) returning id", [f.orgA, f.companyA])).id;
    g2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 2',40) returning id", [f.orgA, f.companyA])).id;
    const p1 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, user_id) values ($1,'Osakas',$2) returning id", [f.orgA, owner1.id])).id;
    const p2 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name) values ($1,'Toinen') returning id", [f.orgA])).id;
    await tx.query(
      "insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, source) values ($1,$2,$3,1,1,'manual'),($1,$4,$5,1,1,'manual')",
      [f.orgA, g1, p1, g2, p2],
    );
    await tx.query(
      `insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values ($1,$2,$3,$4,'owner','t1'), ($1,$5,$3,$6,'resident','t2')`,
      [f.orgA, owner1.id, f.companyA, g1, tenant2.id, g2],
    );
    await tx.query("insert into er_company_billing_settings (organization_id, company_id, company_number) values ($1,$2,34)", [f.orgA, f.companyA]);
  });
});
afterAll(async () => db.close());

describe("mittarit, ennakot ja lukukierros", () => {
  it("henkilökunta kirjaa mittarit pohjalukemilla ja ennakot", async () => {
    await db.asUser(f.accountantA.sub, async (tx) => {
      cold1 = await addMeter(tx, { companyId: f.companyA, shareGroupId: g1, kind: "cold", meterNumber: "K1", location: null, installedOn: "2025-12-31", startReading: "187", notes: null });
      hot1 = await addMeter(tx, { companyId: f.companyA, shareGroupId: g1, kind: "hot", meterNumber: "L1", location: null, installedOn: "2025-12-31", startReading: "57", notes: null });
      cold2 = await addMeter(tx, { companyId: f.companyA, shareGroupId: g2, kind: "cold", meterNumber: "K2", location: null, installedOn: "2025-12-31", startReading: "140", notes: null });
      await setAdvance(tx, { companyId: f.companyA, shareGroupId: g1, monthlyEur: "20.00", startsOn: "2026-01-01", note: null });
      await setAdvance(tx, { companyId: f.companyA, shareGroupId: g1, monthlyEur: "25.00", startsOn: "2026-07-01", note: "korotus" });
      await addChargeBasis(tx, {
        companyId: f.companyA, chargeType: "water", label: null, basis: "meter", unitPrice: "5.56", vatPercent: "0", appliesToKinds: null,
        startsOn: "2025-01-01", decidedOn: null, decisionNote: null, htjChargeType: null,
      });
      await addChargeBasis(tx, {
        companyId: f.companyA, chargeType: "hot_water", label: null, basis: "meter", unitPrice: "10.62", vatPercent: "0", appliesToKinds: null,
        startsOn: "2025-01-01", decidedOn: null, decisionNote: null, htjChargeType: null,
      });
    });
    const adv = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ monthly_eur: string; ends_on: string | null }>("select monthly_eur::text, ends_on::text from er_water_advances where share_group_id = $1 order by starts_on", [g1]),
    );
    expect(adv).toEqual([{ monthly_eur: "20.00", ends_on: "2026-06-30" }, { monthly_eur: "25.00", ends_on: null }]);
  });

  it("kuukausilaskulla vesiennakko omana rivinään", async () => {
    const { runId } = await db.asUser(f.accountantA.sub, (tx) => createBillingRun(tx, { companyId: f.companyA, month: "2026-10", userId: f.accountantA.id }));
    const lines = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ charge_type: string; description: string; amount_eur: string }>("select charge_type, description, amount_eur::text from er_billing_lines where run_id = $1", [runId]),
    );
    expect(lines).toEqual([{ charge_type: "water_advance", description: "Vesiennakko 25,00 €/kk", amount_eur: "25.00" }]);
  });

  it("osakas ilmoittaa lukeman portaalissa vain omaan mittariin avoimella kierroksella", async () => {
    round1 = await db.asUser(f.accountantA.sub, (tx) => createRound(tx, { companyId: f.companyA, readOn: "2026-12-31", portalOpen: true, note: null, userId: f.accountantA.id }));

    const unit = await db.asUser(owner1.sub, (tx) => portalWaterUnit(tx, g1, f.companyA, "2026-12-31"));
    expect(unit).toMatchObject({ openRound: { id: round1 }, advance: { monthlyEur: "25.00" } });
    expect(unit!.meters.map((m) => [m.kind, m.lastReading?.value])).toEqual([["cold", "187.000"], ["hot", "57.000"]]);

    expect(await db.asUser(owner1.sub, (tx) => reportPortalReading(tx, { meterId: cold1, roundId: round1, value: "220", userId: owner1.id }))).toBe(true);
    expect(await db.asUser(owner1.sub, (tx) => reportPortalReading(tx, { meterId: cold1, roundId: round1, value: "221.5", userId: owner1.id }))).toBe(true);
    // Toisen huoneiston mittaria osakas ei näe eikä voi ilmoittaa.
    expect(await db.asUser(owner1.sub, (tx) => reportPortalReading(tx, { meterId: cold2, roundId: round1, value: "1", userId: owner1.id }))).toBe(false);
    await expect(
      db.asUser(owner1.sub, (tx) =>
        tx.query("insert into er_water_readings (organization_id, meter_id, round_id, read_on, reading, source, entered_by) values ($1,$2,$3,'2026-12-31',1,'portal',$4)", [f.orgA, cold2, round1, owner1.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    // Asukas (vuokralainen) voi ilmoittaa oman huoneistonsa lukeman, mutta ei näe ennakkoa.
    expect(await db.asUser(tenant2.sub, (tx) => reportPortalReading(tx, { meterId: cold2, roundId: round1, value: "150", userId: tenant2.id }))).toBe(true);
    const tenantUnit = await db.asUser(tenant2.sub, (tx) => portalWaterUnit(tx, g2, f.companyA, "2026-12-31"));
    expect(tenantUnit?.advance).toBeNull();
  });

  it("kuva mittarista liittyy vain omaan portaalista ilmoitettuun lukemaan (0110)", async () => {
    const photo = (sub: string, userId: string, readingId: string, shareGroupId: string) =>
      db.asUser(sub, (tx) =>
        one<{ id: string }>(
          tx,
          `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
              visibility, subject_table, subject_id, uploaded_by)
           values ($1,$2,$3,'photo','Vesimittarin kuva','kuva.jpg',$4,'image/jpeg',100,'sha','internal','er_water_readings',$5,$6) returning id`,
          [f.orgA, f.companyA, shareGroupId, `polku/${Math.random()}`, readingId, userId],
        ),
      );
    const own = await db.asService((tx) => one<{ id: string }>(tx, "select id from er_water_readings where meter_id = $1 and round_id = $2", [cold1, round1]));
    const other = await db.asService((tx) => one<{ id: string }>(tx, "select id from er_water_readings where meter_id = $1 and round_id = $2", [cold2, round1]));
    const doc = await photo(owner1.sub, owner1.id, own.id, g1);
    await expect(photo(owner1.sub, owner1.id, other.id, g2)).rejects.toThrow(/row-level security/);
    await expect(photo(tenant2.sub, tenant2.id, own.id, g1)).rejects.toThrow(/row-level security/);
    expect(await db.asUser(tenant2.sub, (tx) => tx.query("select id from er_documents where id = $1", [doc.id]))).toHaveLength(0);
    const staff = await db.asUser(f.accountantA.sub, (tx) => roundPhotos(tx, round1));
    expect(staff.get(own.id)).toBe(doc.id);
    await expect(
      db.asUser(tenant2.sub, (tx) => attachReadingPhoto(tx, { meterId: cold1, roundId: round1, userId: tenant2.id, file: new File([new Uint8Array([0xff, 0xd8, 0xff])], "k.jpg", { type: "image/jpeg" }) })),
    ).rejects.toBeInstanceOf(FinanceError);
  });

  it("henkilökunnan lukema ohittaa portaalin eikä osakas voi muuttaa sitä", async () => {
    const res = await db.asUser(f.accountantA.sub, (tx) =>
      saveStaffReadings(tx, { companyId: f.companyA, roundId: round1, userId: f.accountantA.id, readings: [{ meterId: hot1, value: "70.25" }, { meterId: cold2, value: "151" }] }),
    );
    expect(res.saved).toBe(2);
    await expect(db.asUser(tenant2.sub, (tx) => reportPortalReading(tx, { meterId: cold2, roundId: round1, value: "1", userId: tenant2.id }))).rejects.toBeInstanceOf(FinanceError);
    const r = await db.asUser(f.accountantA.sub, (tx) => one<{ reading: string; source: string }>(tx, "select reading::text, source from er_water_readings where meter_id = $1", [cold2]));
    expect(r).toEqual({ reading: "151.000", source: "staff" });
  });

  it("poikkeava lukema vaatii kuittauksen", async () => {
    await expect(db.asUser(owner1.sub, (tx) => reportPortalReading(tx, { meterId: cold1, roundId: round1, value: "188", userId: owner1.id }))).rejects.toThrow(/kuittaa/);
    await expect(
      db.asUser(f.accountantA.sub, (tx) => saveStaffReadings(tx, { companyId: f.companyA, roundId: round1, userId: f.accountantA.id, readings: [{ meterId: hot1, value: "900" }] })),
    ).rejects.toThrow(/kuittaa/);
    const ok = await db.asUser(f.accountantA.sub, (tx) =>
      saveStaffReadings(tx, { companyId: f.companyA, roundId: round1, userId: f.accountantA.id, readings: [{ meterId: hot1, value: "57.5" }], confirmed: true }),
    );
    expect(ok.saved).toBe(1);
    await db.asUser(f.accountantA.sub, (tx) => saveStaffReadings(tx, { companyId: f.companyA, roundId: round1, userId: f.accountantA.id, readings: [{ meterId: hot1, value: "70.25" }] }));
  });

  it("toinen organisaatio ei näe mittareita eikä lukemia", async () => {
    for (const t of ["er_water_meters", "er_water_readings", "er_water_reading_rounds", "er_water_advances"]) {
      expect(await db.asUser(f.managerB.sub, (tx) => tx.query(`select id from ${t}`)), t).toHaveLength(0);
    }
  });
});

describe("tasauslasku", () => {
  let runId: string;

  it("kulutus mittareittain vanhalla ja uudella lukemalla, ennakot miinusrivinä", async () => {
    const res = await db.asUser(f.accountantA.sub, (tx) =>
      createWaterSettlement(tx, { companyId: f.companyA, roundId: round1, periodStart: "2026-01-01", periodEnd: "2026-12-31", dueOn: "2027-02-05", userId: f.accountantA.id }),
    );
    runId = res.runId;
    const lines = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ unit_label: string; line_no: number; charge_type: string; description: string; amount_eur: string; reading_start: string | null; reading_end: string | null }>(
        `select g.unit_label, l.line_no, l.charge_type, l.description, l.amount_eur::text, l.reading_start::text, l.reading_end::text
           from er_billing_lines l join er_share_groups g on g.id = l.share_group_id where l.run_id = $1 order by g.unit_label, l.line_no`,
        [runId],
      ),
    );
    expect(lines).toEqual([
      { unit_label: "A 1", line_no: 1, charge_type: "water", description: "Kylmä vesi, mittari K1: lukema 31.12.2025 187 → 31.12.2026 221,5 = 34,5 m³ × 5,56 €/m³", amount_eur: "191.82", reading_start: "187.000", reading_end: "221.500" },
      { unit_label: "A 1", line_no: 2, charge_type: "hot_water", description: "Lämmin vesi, mittari L1: lukema 31.12.2025 57 → 31.12.2026 70,25 = 13,25 m³ × 10,62 €/m³", amount_eur: "140.72", reading_start: "57.000", reading_end: "70.250" },
      { unit_label: "A 1", line_no: 3, charge_type: "water_advance", description: "Vesiennakot 1.1.2026–30.6.2026, 6 kk × 20,00 €", amount_eur: "-120.00", reading_start: null, reading_end: null },
      { unit_label: "A 1", line_no: 4, charge_type: "water_advance", description: "Vesiennakot 1.7.2026–31.12.2026, 6 kk × 25,00 €", amount_eur: "-150.00", reading_start: null, reading_end: null },
      { unit_label: "A 2", line_no: 1, charge_type: "water", description: "Kylmä vesi, mittari K2: lukema 31.12.2025 140 → 31.12.2026 151 = 11 m³ × 5,56 €/m³", amount_eur: "61.16", reading_start: "140.000", reading_end: "151.000" },
    ]);
    const round = await db.asUser(f.accountantA.sub, (tx) => one<{ status: string }>(tx, "select status from er_water_reading_rounds where id = $1", [round1]));
    expect(round.status).toBe("closed");

    // Kulutus kulutusseurantaan huoneistoittain (0109): kylmä + lämmin, hinta ilman ennakoita.
    const consumption = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ unit_label: string; period_start: string; period_end: string; amount: string; cost_eur: string; source: string }>(
        `select g.unit_label, c.period_start::text, c.period_end::text, c.amount::text, c.cost_eur::text, c.source
           from er_consumption_readings c join er_share_groups g on g.id = c.share_group_id where c.billing_run_id = $1 order by g.unit_label`,
        [runId],
      ),
    );
    expect(consumption).toEqual([
      { unit_label: "A 1", period_start: "2025-12-31", period_end: "2026-12-31", amount: "47.750", cost_eur: "332.54", source: "water_billing" },
      { unit_label: "A 2", period_start: "2025-12-31", period_end: "2026-12-31", amount: "11.000", cost_eur: "61.16", source: "water_billing" },
    ]);
    const metered = await db.asUser(f.accountantA.sub, (tx) => listMeteredWater(tx, f.companyA));
    expect(metered[0]).toMatchObject({ units: 2, metered_m3: 58.75, main_m3: null });
    await expect(
      db.asUser(f.accountantA.sub, (tx) => saveStaffReadings(tx, { companyId: f.companyA, roundId: round1, userId: f.accountantA.id, readings: [{ meterId: cold2, value: "152" }] })),
    ).rejects.toThrow(/tasauslaskutus/);
    // Tasausajo ei estä saman kauden vastikeajoa.
    await db.asUser(f.accountantA.sub, (tx) => createBillingRun(tx, { companyId: f.companyA, month: "2026-01", userId: f.accountantA.id }));
  });

  it("seuraava tasaus alkaa laskutetusta lukemasta; vaihdetun mittarin loppulukema mukaan", async () => {
    const billed = await db.asUser(f.accountantA.sub, (tx) => lastBilledReadings(tx, f.companyA));
    expect(billed.get(cold1)).toEqual({ value: "221.500", on: "2026-12-31" });

    const round2 = await db.asUser(f.accountantA.sub, async (tx) => {
      const newCold = await replaceMeter(tx, { companyId: f.companyA, meterId: cold2, removedOn: "2027-03-15", finalReading: "155", newMeterNumber: "K2b", newStartReading: "0" });
      const id = await createRound(tx, { companyId: f.companyA, readOn: "2027-12-31", portalOpen: false, note: null, userId: f.accountantA.id });
      await saveStaffReadings(tx, { companyId: f.companyA, roundId: id, userId: f.accountantA.id, readings: [{ meterId: cold1, value: "250" }, { meterId: newCold!, value: "9" }] });
      return id;
    });
    const res = await db.asUser(f.accountantA.sub, (tx) =>
      createWaterSettlement(tx, { companyId: f.companyA, roundId: round2, periodStart: "2027-01-01", periodEnd: "2027-12-31", dueOn: null, userId: f.accountantA.id }),
    );
    expect(res.warnings).toContain("A 1: lämmin vesi, mittari L1 lukema puuttuu");
    const lines = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query<{ description: string }>("select l.description from er_billing_lines l where l.run_id = $1 and l.charge_type = 'water' order by l.reference_number, l.line_no", [res.runId]),
    );
    expect(lines.map((l) => l.description)).toEqual([
      "Kylmä vesi, mittari K1: lukema 31.12.2026 221,5 → 31.12.2027 250 = 28,5 m³ × 5,56 €/m³",
      "Kylmä vesi, mittari K2: lukema 31.12.2026 151 → 15.3.2027 155 = 4 m³ × 5,56 €/m³",
      "Kylmä vesi, mittari K2b: lukema 15.3.2027 0 → 31.12.2027 9 = 9 m³ × 5,56 €/m³",
    ]);

    // Peruttu ajo ei ole laskutettu lukema, eikä sen kulutus jää kulutusseurantaan.
    const before = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_consumption_readings where billing_run_id = $1", [res.runId]));
    expect(before.length).toBeGreaterThan(0);
    expect(await db.asUser(f.accountantA.sub, (tx) => cancelBillingRun(tx, res.runId, f.companyA))).toBe(true);
    expect(await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_consumption_readings where billing_run_id = $1", [res.runId]))).toHaveLength(0);
    const after = await db.asUser(f.accountantA.sub, (tx) => lastBilledReadings(tx, f.companyA));
    expect(after.get(cold1)).toEqual({ value: "221.500", on: "2026-12-31" });
    void runId;
  });
});

describe("lukupyyntö ja muistutus", () => {
  it("pyyntö asukkaalle tai osakkaalle, muistutus vain puuttuville, kumpikin kerran", async () => {
    await db.asService(async (tx) => {
      await tx.query("update er_parties set email = 'osakas@example.test' where user_id = $1", [owner1.id]);
      const t = await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, email, user_id) values ($1,'Vuokralainen','asukas@example.test',$2) returning id", [f.orgA, tenant2.id]);
      await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,'tenant')", [f.orgA, g2, t.id]);
      await tx.query("update er_parties set email = 'vuokranantaja@example.test' where last_name = 'Toinen'");
    });
    const roundId = await db.asUser(f.accountantA.sub, (tx) =>
      createRound(tx, { companyId: f.companyA, readOn: "2028-12-31", reportBy: "2029-01-10", portalOpen: true, note: null, userId: f.accountantA.id }),
    );

    // Ennen lukemapäivää ei lähetetä mitään.
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2028-12-30", "https://erappu.test"))).toEqual({ requests: 0, reminders: 0, messages: 0 });
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2028-12-31", "https://erappu.test"))).toEqual({ requests: 1, reminders: 0, messages: 2 });
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2028-12-31", "https://erappu.test"))).toEqual({ requests: 0, reminders: 0, messages: 0 });

    const sent = await db.asService((tx) =>
      tx.query<{ recipient: string; subject: string; body: string }>("select recipient, subject, body from er_outbound_messages where subject_id = $1 order by recipient", [roundId]),
    );
    expect(sent.map((m) => m.recipient)).toEqual(["asukas@example.test", "osakas@example.test"]);
    expect(sent[0].subject).toBe("Lue vesimittari: As Oy Testi A");
    expect(sent[0].body).toContain("huoneiston A 2 vesimittari");
    expect(sent[0].body).toContain("viimeistään 10.1.2029");
    expect(sent[0].body).toContain("https://erappu.test/portaali/oma#vesi");

    // A 1:n molemmat mittarit luettu, A 2 puuttuu → muistutus vain asukkaalle kaksi päivää ennen määräpäivää.
    await db.asUser(f.accountantA.sub, (tx) =>
      saveStaffReadings(tx, { companyId: f.companyA, roundId, userId: f.accountantA.id, readings: [{ meterId: cold1, value: "300" }, { meterId: hot1, value: "90" }], confirmed: true }),
    );
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2029-01-07", null))).toEqual({ requests: 0, reminders: 0, messages: 0 });
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2029-01-08", null))).toEqual({ requests: 0, reminders: 1, messages: 1 });
    expect(await db.asService((tx) => queueDueReadingMessages(tx, "2029-01-09", null))).toEqual({ requests: 0, reminders: 0, messages: 0 });
    const reminder = await db.asService((tx) =>
      one<{ recipient: string; subject: string }>(tx, "select recipient, subject from er_outbound_messages where subject_id = $1 and subject like 'Muistutus%'", [roundId]),
    );
    expect(reminder).toEqual({ recipient: "asukas@example.test", subject: "Muistutus: vesimittarin lukema puuttuu, As Oy Testi A" });
  });
});
