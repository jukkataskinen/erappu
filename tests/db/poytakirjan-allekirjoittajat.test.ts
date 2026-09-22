import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { createMeeting } from "@/lib/meetings/mutations";
import { loadMinutesSignerPlan } from "@/lib/meetings/minutes-signers";

/** Allekirjoittajat tietokannasta: yhtiön sääntö (0113), läsnäolot ja rekisterin puheenjohtaja. */

let db: Database;
let f: Fixture;
let meetingId: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  const m = await db.asUser(f.managerA.sub, (tx) =>
    createMeeting(tx, { companyId: f.companyA, kind: "board", startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), location: null, remoteParticipation: false, remoteUrl: null, fiscalYear: null, createdBy: f.managerA.id }),
  );
  meetingId = m!.id;
  await db.asService(async (tx) => {
    await tx.query("update er_housing_companies set board_minutes_signers = 'all_present' where id = $1", [f.companyA]);
    const chair = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Olavi','Jouttijärvi','pj@example.test') returning id", [f.orgA])).id;
    const member = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Eila','Hokkanen','eh@example.test') returning id", [f.orgA])).id;
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2026-01-01'),($1,$2,$4,'member','2026-01-01')", [f.orgA, f.companyA, chair, member]);
    await tx.query(
      "insert into er_meeting_attendees (organization_id, meeting_id, party_id, display_name) values ($1,$2,$3,'Jouttijärvi Olavi'),($1,$2,$4,'Hokkanen Eila')",
      [f.orgA, meetingId, chair, member],
    );
  });
});
afterAll(async () => db.close());

describe("pöytäkirjan allekirjoittajat kokoukselle", () => {
  it("ennen kokousta: kaikki osallistujat ja puheenjohtaja rekisteristä", async () => {
    const plan = await db.asUser(f.managerA.sub, (tx) => loadMinutesSignerPlan(tx, meetingId));
    expect(plan?.rule).toBe("all_present");
    expect(plan?.preview).toBe(true);
    expect(plan?.chairFromRegistry).toBe(true);
    expect(plan?.problems).toEqual([]);
    expect(plan?.signers.map((s) => s.email)).toEqual(["pj@example.test", "eh@example.test"]);
  });

  it("pidetty kokous: vain läsnä olleet", async () => {
    await db.asService((tx) => tx.query("update er_meetings set status = 'held' where id = $1", [meetingId]));
    await db.asService((tx) => tx.query("update er_meeting_attendees set present = true where meeting_id = $1 and display_name = 'Jouttijärvi Olavi'", [meetingId]));
    const plan = await db.asUser(f.managerA.sub, (tx) => loadMinutesSignerPlan(tx, meetingId));
    expect(plan?.preview).toBe(false);
    expect(plan?.signers.map((s) => s.email)).toEqual(["pj@example.test"]);
  });
});
