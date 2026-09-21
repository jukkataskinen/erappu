import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { AttachmentError, attachDocument, listItemAttachments, removeAttachment } from "@/lib/meetings/attachments";
import { createMeeting, moveItem } from "@/lib/meetings/mutations";
import { listItems } from "@/lib/meetings/queries";

/** Pykälän liitteet (0112): numerointi, näkyvyys ja lukitus. */

let db: Database;
let f: Fixture;
let owner: { id: string; sub: string };
let general: string;
let board: string;
let itemId: string;
const docs: Record<string, string> = {};

const doc = (tx: Sql, org: string, company: string, title: string, visibility: string) =>
  one<{ id: string }>(
    tx,
    `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility)
     values ($1,$2,'other',$3,'x.pdf',$4,'application/pdf',1,'00',$5) returning id`,
    [org, company, title, `test/${title}`, visibility],
  ).then((r) => r.id);

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner = await createUser(db);
  const make = async (kind: "annual_general" | "board") => {
    const m = await db.asUser(f.managerA.sub, (tx) =>
      createMeeting(tx, { companyId: f.companyA, kind, startsAt: new Date(Date.now() + 20 * 86400000).toISOString(), location: null, remoteParticipation: false, remoteUrl: null, fiscalYear: "2026", createdBy: f.managerA.id }),
    );
    if (!m) throw new Error("ei luotu");
    return m.id;
  };
  general = await make("annual_general");
  board = await make("board");
  await db.asService(async (tx) => {
    await tx.query("update er_meetings set status = 'notice_sent' where id = any($1::uuid[])", [[general, board]]);
    const g = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values ($1,$2,$3,$4,'owner','test')", [f.orgA, owner.id, f.companyA, g]);
    docs.statement = await doc(tx, f.orgA, f.companyA, "Tilinpäätös 2025", "owners");
    docs.offer = await doc(tx, f.orgA, f.companyA, "Urakkatarjous", "internal");
    docs.boardOnly = await doc(tx, f.orgA, f.companyA, "Hallituksen muistio", "board");
    docs.other = await doc(tx, f.orgB, f.companyB, "Toisen yhtiön", "owners");
  });
  itemId = (await db.asUser(f.managerA.sub, (tx) => listItems(tx, general)))[2].id;
});
afterAll(async () => db.close());

describe("pykälän liitteet", () => {
  it("numeroituvat pykälän mukaan: Liite 3.1, 3.2", async () => {
    await db.asUser(f.managerA.sub, async (tx) => {
      await attachDocument(tx, { meetingId: general, itemId, documentId: docs.statement, userId: f.managerA.id });
      await attachDocument(tx, { meetingId: general, itemId, documentId: docs.offer, userId: f.managerA.id });
    });
    const list = await db.asUser(f.managerA.sub, (tx) => listItemAttachments(tx, general));
    expect(list.map((a) => [a.label, a.title])).toEqual([
      ["Liite 3.1", "Tilinpäätös 2025"],
      ["Liite 3.2", "Urakkatarjous"],
    ]);
  });

  it("samaa dokumenttia ei liitetä kahdesti eikä toisen yhtiön dokumenttia lainkaan", async () => {
    await expect(db.asUser(f.managerA.sub, (tx) => attachDocument(tx, { meetingId: general, itemId, documentId: docs.statement, userId: f.managerA.id }))).rejects.toThrow(AttachmentError);
    await expect(db.asUser(f.managerA.sub, (tx) => attachDocument(tx, { meetingId: general, itemId, documentId: docs.other, userId: f.managerA.id }))).rejects.toThrow(/ei löytynyt/);
  });

  it("toisen organisaation isännöitsijä ei näe eikä muuta liitteitä", async () => {
    expect(await db.asUser(f.managerB.sub, (tx) => listItemAttachments(tx, general))).toEqual([]);
    await expect(db.asUser(f.managerB.sub, (tx) => attachDocument(tx, { meetingId: general, itemId, documentId: docs.other, userId: f.managerB.id }))).rejects.toThrow(/Asiaa ei löytynyt/);
  });

  it("osakas näkee luettelon, mutta sisäisen dokumentin otsikko jää piiloon", async () => {
    const list = await db.asUser(owner.sub, (tx) => listItemAttachments(tx, general));
    expect(list.map((a) => [a.label, a.title])).toEqual([
      ["Liite 3.1", "Tilinpäätös 2025"],
      ["Liite 3.2", null],
    ]);
  });

  it("osakas ei näe hallituksen kokouksen liitteitä", async () => {
    const boardItem = (await db.asUser(f.managerA.sub, (tx) => listItems(tx, board)))[0].id;
    await db.asUser(f.managerA.sub, (tx) => attachDocument(tx, { meetingId: board, itemId: boardItem, documentId: docs.boardOnly, userId: f.managerA.id }));
    expect(await db.asUser(owner.sub, (tx) => listItemAttachments(tx, board))).toEqual([]);
  });

  it("tunnus seuraa pykälää, kun asia siirtyy, ja poisto tiivistää numeroinnin", async () => {
    await db.asUser(f.managerA.sub, (tx) => moveItem(tx, general, itemId, "up"));
    let list = await db.asUser(f.managerA.sub, (tx) => listItemAttachments(tx, general));
    expect(list.map((a) => a.label)).toEqual(["Liite 2.1", "Liite 2.2"]);

    await db.asUser(f.managerA.sub, (tx) => removeAttachment(tx, { meetingId: general, attachmentId: list[0].id, userId: f.managerA.id }));
    list = await db.asUser(f.managerA.sub, (tx) => listItemAttachments(tx, general));
    expect(list.map((a) => [a.label, a.title])).toEqual([["Liite 2.1", "Urakkatarjous"]]);
    // Dokumentti jää yhtiön dokumentteihin.
    const [kept] = await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_documents where id = $1", [docs.statement]));
    expect(kept).toBeTruthy();
  });

  it("allekirjoitetun pöytäkirjan kokouksen liitteitä ei voi muuttaa", async () => {
    await db.asService((tx) => tx.query("update er_meetings set status = 'minutes_signed' where id = $1", [general]));
    await expect(db.asUser(f.managerA.sub, (tx) => attachDocument(tx, { meetingId: general, itemId, documentId: docs.statement, userId: f.managerA.id }))).rejects.toThrow(/allekirjoitettu/);
  });
});
