import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { daySlots, parseOpenHours } from "@/lib/bookings/slots";
import { bookingErrorMessage, cancelBooking, createBooking, getResource, listResources, resourceBusy } from "@/lib/bookings/queries";
import { completeTask, createAnnualCycleForCompany, insertTask, listTasks } from "@/lib/tasks/queries";
import { queueTaskReminders } from "@/lib/tasks/reminders";
import { queueContractReminders } from "@/lib/contracts/reminders";
import { upsertReading } from "@/lib/consumption/queries";

let db: Database;
let f: Fixture;
let ownerA: { id: string; sub: string };
let neighbourA: { id: string; sub: string };
let ownerB: { id: string; sub: string };
let boardA: { id: string; sub: string };
let groupA1: string;
let groupA2: string;
let groupB1: string;

const ALL_DAY = parseOpenHours(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]])));

async function portalOwner(tx: Sql, org: string, company: string, unit: string, userId: string, last: string) {
  const g = await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,$3,50) returning id", [org, company, unit]);
  const p = await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Testi',$2,$3) returning id", [org, last, userId]);
  await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual')", [org, g.id, p.id]);
  await syncPortalAccessForGroup(tx, g.id);
  return { groupId: g.id, partyId: p.id };
}

async function resource(companyId: string, opts: { max?: number | null; recurring?: boolean; name?: string } = {}) {
  return db.asService(async (tx) => {
    const org = await one<{ organization_id: string }>(tx, "select organization_id from er_housing_companies where id = $1", [companyId]);
    const r = await one<{ id: string }>(
      tx,
      `insert into er_bookable_resources (organization_id, company_id, name, slot_minutes, open_hours, max_active_bookings_per_unit, allow_recurring)
       values ($1,$2,$3,60,$4,$5,$6) returning id`,
      [org.organization_id, companyId, opts.name ?? "Sauna", JSON.stringify(ALL_DAY), opts.max ?? null, opts.recurring ?? false],
    );
    return r.id;
  });
}

const slotsOn = (date: string) => daySlots(date, ALL_DAY, 60);

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  ownerA = await createUser(db);
  neighbourA = await createUser(db);
  ownerB = await createUser(db);
  boardA = await createUser(db);
  await db.asService(async (tx) => {
    groupA1 = (await portalOwner(tx, f.orgA, f.companyA, "A 1", ownerA.id, "Osakas")).groupId;
    groupA2 = (await portalOwner(tx, f.orgA, f.companyA, "A 2", neighbourA.id, "Naapuri")).groupId;
    groupB1 = (await portalOwner(tx, f.orgB, f.companyB, "B 1", ownerB.id, "Toinen")).groupId;
    const p = await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, user_id) values ($1,'Paula','Hallitus',$2) returning id", [f.orgA, boardA.id]);
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2020-01-01')", [f.orgA, f.companyA, p.id]);
    await syncPortalAccessForBoard(tx, f.companyA);
  });
});
afterAll(async () => db.close());

describe("varausten päällekkäisyys kannassa", () => {
  it("päällekkäinen varaus estetään, peruttu ei estä", async () => {
    const res = await resource(f.companyA, { name: "Pesutupa" });
    const [s] = slotsOn("2030-01-07");
    await db.asUser(f.managerA.sub, (tx) =>
      tx.query("insert into er_bookings (resource_id, share_group_id, starts_at, ends_at) values ($1,$2,$3,$4)", [res, groupA1, s.startsAt, s.endsAt]),
    );
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_bookings (resource_id, share_group_id, starts_at, ends_at) values ($1,$2,$3::timestamptz + interval '30 minutes',$4::timestamptz + interval '30 minutes')", [res, groupA2, s.startsAt, s.endsAt]),
      ),
    ).rejects.toThrow(/conflicting key value|exclusion constraint/);

    await db.asUser(f.managerA.sub, (tx) => tx.query("update er_bookings set cancelled_at = now() where resource_id = $1", [res]));
    const rows = await db.asUser(f.managerA.sub, (tx) =>
      tx.query("insert into er_bookings (resource_id, share_group_id, starts_at, ends_at) values ($1,$2,$3,$4) returning organization_id, company_id", [res, groupA2, s.startsAt, s.endsAt]),
    );
    expect(rows[0]).toMatchObject({ organization_id: f.orgA, company_id: f.companyA });
  });

  it("portaalin samanaikainen varaus samaan vuoroon antaa selkeän virheen", async () => {
    const resId = await resource(f.companyA, { name: "Kerhohuone" });
    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resId)))!;
    const [, s] = slotsOn("2030-01-08");
    await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupA1, userId: ownerA.id, recurring: false }));
    const err = await db.asUser(neighbourA.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupA2, userId: neighbourA.id, recurring: false })).catch((e) => e);
    expect(bookingErrorMessage(err)).toBe("Vuoro on jo varattu. Valitse toinen aika.");
  });
});

describe("varausten RLS portaalissa", () => {
  let resA: string;
  let resB: string;
  let bookingId: string;

  beforeAll(async () => {
    resA = await resource(f.companyA, { name: "Sauna A" });
    resB = await resource(f.companyB, { name: "Sauna B" });
    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resA)))!;
    const s = slotsOn("2030-02-04")[18];
    await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupA1, userId: ownerA.id, recurring: false, note: "Oma huomautus" }));
    bookingId = (await db.asService((tx) => one<{ id: string }>(tx, "select id from er_bookings where resource_id = $1", [resA]))).id;
  });

  it("portaalikäyttäjä ei näe toisen yhtiön resursseja", async () => {
    const mine = await db.asUser(ownerA.sub, (tx) => listResources(tx));
    expect(mine.map((r) => r.id)).toContain(resA);
    expect(mine.map((r) => r.id)).not.toContain(resB);
    expect(await db.asUser(ownerB.sub, (tx) => getResource(tx, resA))).toBeNull();
    expect(await db.asUser(ownerB.sub, (tx) => resourceBusy(tx, resA, "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"))).toEqual([]);
  });

  it("muiden varaajien henkilötiedot eivät näy, vain varattu aika", async () => {
    const rows = await db.asUser(neighbourA.sub, (tx) => tx.query("select * from er_bookings where resource_id = $1", [resA]));
    expect(rows).toHaveLength(0);
    const busy = await db.asUser(neighbourA.sub, (tx) => resourceBusy(tx, resA, "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"));
    expect(busy).toHaveLength(1);
    expect(busy[0].mine).toBe(false);
    expect(busy[0].own_booking_id).toBeNull();
    expect(Object.keys(busy[0]).sort()).toEqual(["ends_at", "mine", "own_booking_id", "starts_at"]);

    const own = await db.asUser(ownerA.sub, (tx) => resourceBusy(tx, resA, "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"));
    expect(own[0]).toMatchObject({ mine: true, own_booking_id: bookingId });
  });

  it("toisen varausta ei voi perua", async () => {
    const res = await db.asUser(neighbourA.sub, (tx) => cancelBooking(tx, { bookingId, userId: neighbourA.id, onlyOwn: true }));
    expect(res.cancelled).toBe(0);
    const direct = await db.asUser(neighbourA.sub, (tx) => tx.query("update er_bookings set cancelled_at = now() where id = $1 returning id", [bookingId]));
    expect(direct).toHaveLength(0);
    const still = await db.asService((tx) => one<{ cancelled_at: Date | null }>(tx, "select cancelled_at from er_bookings where id = $1", [bookingId]));
    expect(still.cancelled_at).toBeNull();
  });

  it("omaa varausta ei voi siirtää eikä varata toisen huoneiston nimissä", async () => {
    await expect(
      db.asUser(ownerA.sub, (tx) => tx.query("update er_bookings set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1", [bookingId])),
    ).rejects.toThrow(/booking_update_not_allowed/);

    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resA)))!;
    const s = slotsOn("2030-02-05")[10];
    await expect(
      db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupA2, userId: ownerA.id, recurring: false })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupA1, userId: neighbourA.id, recurring: false })),
    ).rejects.toThrow(/row-level security/);
  });

  it("toisen yhtiön osakas ei voi varata", async () => {
    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resA)))!;
    const s = slotsOn("2030-02-06")[10];
    await expect(
      db.asUser(ownerB.sub, (tx) => createBooking(tx, { resource: r, slot: s, shareGroupId: groupB1, userId: ownerB.id, recurring: false })),
    ).rejects.toThrow(/row-level security/);
  });

  it("oman varauksen voi perua", async () => {
    const res = await db.asUser(ownerA.sub, (tx) => cancelBooking(tx, { bookingId, userId: ownerA.id, onlyOwn: true }));
    expect(res.cancelled).toBe(1);
    await expect(
      db.asUser(ownerA.sub, (tx) => tx.query("update er_bookings set cancelled_at = null where id = $1", [bookingId])),
    ).rejects.toThrow(/booking_update_not_allowed/);
  });

  it("toinen organisaatio ei näe resursseja eikä varauksia", async () => {
    const resources = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_bookable_resources where company_id = $1", [f.companyA]));
    const bookings = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_bookings where company_id = $1", [f.companyA]));
    expect(resources).toHaveLength(0);
    expect(bookings).toHaveLength(0);
    await expect(
      db.asUser(f.managerB.sub, (tx) =>
        tx.query("insert into er_bookable_resources (organization_id, company_id, name) values ($1,$2,'kaapattu')", [f.orgA, f.companyA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("kiintiö", () => {
  it("huoneiston tulevien varausten enimmäismäärä, vakiovuoro lasketaan yhdeksi", async () => {
    const resId = await resource(f.companyA, { name: "Kuntosali", max: 2, recurring: true });
    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resId)))!;
    const day = slotsOn("2030-03-04");

    const series = await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[8], shareGroupId: groupA1, userId: ownerA.id, recurring: true }));
    expect(series.created).toBe(12);
    await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[10], shareGroupId: groupA1, userId: ownerA.id, recurring: false }));
    const err = await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[12], shareGroupId: groupA1, userId: ownerA.id, recurring: false })).catch((e) => e);
    expect(bookingErrorMessage(err)).toMatch(/enimmäismäärä/);

    // Naapurihuoneistolla on oma kiintiönsä.
    await db.asUser(neighbourA.sub, (tx) => createBooking(tx, { resource: r, slot: day[12], shareGroupId: groupA2, userId: neighbourA.id, recurring: false }));

    // Vakiovuoron peruminen vapauttaa kiintiön.
    const first = await db.asService((tx) => one<{ id: string }>(tx, "select id from er_bookings where series_id = $1 order by starts_at limit 1", [series.seriesId]));
    const cancelled = await db.asUser(ownerA.sub, (tx) => cancelBooking(tx, { bookingId: first.id, userId: ownerA.id, wholeSeries: true, onlyOwn: true }));
    expect(cancelled.cancelled).toBe(12);
    await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[14], shareGroupId: groupA1, userId: ownerA.id, recurring: false }));
  });

  it("vakiovuoro vain jos kohde sallii, henkilökunta ohittaa kiintiön", async () => {
    const resId = await resource(f.companyA, { name: "Talopesula", max: 1, recurring: false });
    const r = (await db.asUser(ownerA.sub, (tx) => getResource(tx, resId)))!;
    const day = slotsOn("2030-03-05");
    await expect(
      db.asUser(ownerA.sub, (tx) => tx.query("insert into er_bookings (resource_id, share_group_id, user_id, starts_at, ends_at, recurring_weekly) values ($1,$2,$3,$4,$5,true)", [resId, groupA1, ownerA.id, day[1].startsAt, day[1].endsAt])),
    ).rejects.toThrow(/booking_recurring_not_allowed/);
    await db.asUser(ownerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[2], shareGroupId: groupA1, userId: ownerA.id, recurring: false }));
    await db.asUser(f.managerA.sub, (tx) => createBooking(tx, { resource: r, slot: day[3], shareGroupId: groupA1, userId: f.managerA.id, recurring: false }));
    await expect(
      db.asUser(ownerA.sub, (tx) => tx.query("insert into er_bookings (resource_id, share_group_id, user_id, starts_at, ends_at) values ($1,$2,$3,'2020-01-01T10:00Z','2020-01-01T11:00Z')", [resId, groupA2, ownerA.id])),
    ).rejects.toThrow(/booking_in_past|row-level security/);
  });
});

describe("vuosikello", () => {
  it("kuittaus luo toistuvan tehtävän seuraavan esiintymän kerran", async () => {
    const id = await db.asUser(f.accountantA.sub, (tx) =>
      insertTask(tx, {
        organizationId: f.orgA, companyId: f.companyA, title: "Kuukausiraportti", description: null, dueOn: "2026-01-31",
        recurrence: { freq: "monthly", interval: 1 }, category: "financial_statement", assigneeUserId: f.accountantA.id, createdBy: f.accountantA.id,
      }),
    );
    const first = await db.asUser(f.accountantA.sub, (tx) => completeTask(tx, { taskId: id, userId: f.accountantA.id }));
    expect(first).toMatchObject({ completed: true, nextDue: "2026-02-28" });
    const again = await db.asUser(f.accountantA.sub, (tx) => completeTask(tx, { taskId: id, userId: f.accountantA.id }));
    expect(again.completed).toBe(false);
    const next = await db.asUser(f.accountantA.sub, (tx) => completeTask(tx, { taskId: first.nextId!, userId: f.accountantA.id }));
    expect(next.nextDue).toBe("2026-03-31");
    const series = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from er_tasks where series_id = $1", [id]));
    expect(series[0].n).toBe(3);
  });

  it("vakiovuosikellon voi luoda uudelleen ilman tuplia", async () => {
    const a = await db.asUser(f.managerA.sub, (tx) => createAnnualCycleForCompany(tx, { companyId: f.companyA, userId: f.managerA.id, today: "2026-09-15" }));
    expect(a).toMatchObject({ created: 18, skipped: 0 });
    const b = await db.asUser(f.managerA.sub, (tx) => createAnnualCycleForCompany(tx, { companyId: f.companyA, userId: f.managerA.id, today: "2026-09-15" }));
    expect(b).toMatchObject({ created: 0, skipped: 18 });
    const meeting = await db.asUser(f.managerA.sub, (tx) => listTasks(tx, { organizationId: f.orgA, companyId: f.companyA, category: "general_meeting", today: "2026-09-15" }));
    expect(meeting.map((t) => t.due_on)).toEqual(["2027-06-30"]);
    expect(await db.asUser(f.managerB.sub, (tx) => createAnnualCycleForCompany(tx, { companyId: f.companyA, userId: f.managerB.id, today: "2026-09-15" }))).toBeNull();
  });

  it("vastuuhenkilön on oltava organisaation jäsen", async () => {
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        insertTask(tx, { organizationId: f.orgA, companyId: null, title: "x", description: null, dueOn: "2026-10-01", recurrence: null, category: "other", assigneeUserId: f.managerB.id, createdBy: f.managerA.id }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("tehtävät vain henkilökunnalle, toinen organisaatio ei näe", async () => {
    for (const sub of [ownerA.sub, boardA.sub, f.managerB.sub]) {
      const rows = await db.asUser(sub, (tx) => tx.query("select id from er_tasks"));
      expect(rows).toHaveLength(0);
    }
  });

  it("muistutukset ovat idempotentteja", async () => {
    await db.asUser(f.managerA.sub, (tx) =>
      insertTask(tx, { organizationId: f.orgA, companyId: f.companyA, title: "Tarkista pelastussuunnitelma", description: null, dueOn: "2026-09-15", recurrence: null, category: "other", assigneeUserId: f.managerA.id, createdBy: f.managerA.id }),
    );
    const first = await db.asService((tx) => queueTaskReminders(tx, "2026-09-15", "https://erappu.test"));
    expect(first.messages).toBeGreaterThan(0);
    const second = await db.asService((tx) => queueTaskReminders(tx, "2026-09-15", "https://erappu.test"));
    expect(second).toEqual({ messages: 0, tasks: 0 });
    const tomorrow = await db.asService((tx) => queueTaskReminders(tx, "2026-09-16", "https://erappu.test"));
    expect(tomorrow.tasks).toBe(0);
    const week = await db.asService((tx) => queueTaskReminders(tx, "2026-09-22", "https://erappu.test"));
    expect(week.tasks).toBeGreaterThan(0);
  });
});

describe("sopimukset ja kulutus", () => {
  it("hallitus näkee sopimukset ja kulutuksen, osakas ja toinen organisaatio eivät", async () => {
    await db.asUser(f.managerA.sub, async (tx) => {
      await tx.query(
        "insert into er_contracts (organization_id, company_id, counterparty, category, ends_on, notice_months, reminder_on) values ($1,$2,'Vakuutus Oy','insurance','2026-12-31',3,'2026-08-31')",
        [f.orgA, f.companyA],
      );
      await upsertReading(tx, { organizationId: f.orgA, companyId: f.companyA, utility: "electricity", periodStart: "2026-01-01", periodEnd: "2026-01-31", amount: 100, unit: "kWh", costEur: 20, source: "manual", createdBy: f.managerA.id });
    });
    const again = await db.asUser(f.accountantA.sub, (tx) =>
      upsertReading(tx, { organizationId: f.orgA, companyId: f.companyA, utility: "electricity", periodStart: "2026-01-01", periodEnd: "2026-01-31", amount: 120, unit: "kWh", costEur: 22, source: "csv", createdBy: f.accountantA.id }),
    );
    expect(again).toBe("updated");

    expect(await db.asUser(boardA.sub, (tx) => tx.query("select id from er_contracts"))).toHaveLength(1);
    expect(await db.asUser(boardA.sub, (tx) => tx.query("select id from er_consumption_readings"))).toHaveLength(1);
    expect(await db.asUser(ownerA.sub, (tx) => tx.query("select id from er_contracts"))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_contracts"))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_consumption_readings"))).toHaveLength(0);
    await expect(
      db.asUser(boardA.sub, (tx) => tx.query("insert into er_contracts (organization_id, company_id, counterparty) values ($1,$2,'x')", [f.orgA, f.companyA])),
    ).rejects.toThrow(/row-level security|permission denied/);
    // Kirjanpitäjä ei muokkaa sopimuksia.
    expect(await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_contracts set counterparty = 'x' returning id"))).toHaveLength(0);
  });

  it("sopimusmuistutus lähtee kerran", async () => {
    const first = await db.asService((tx) => queueContractReminders(tx, "2026-09-15", "https://erappu.test"));
    expect(first.contracts).toBe(1);
    expect(first.messages).toBe(1);
    const second = await db.asService((tx) => queueContractReminders(tx, "2026-09-15", "https://erappu.test"));
    expect(second.contracts).toBe(0);
    const msg = await db.asService((tx) => one<{ recipient: string; body: string }>(tx, "select recipient, body from er_outbound_messages where subject_table = 'er_contracts'"));
    expect(msg.body).toContain("30.9.2026");
  });
});
