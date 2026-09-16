import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContactError, createThread, postMessage, setThreadClosed } from "@/lib/contacts/mutations";
import { countOpenThreads, getThread, listPortalThreads, listStaffThreads, listThreadEntries } from "@/lib/contacts/queries";
import type { Database } from "@/lib/db/types";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import { seedRinne, type RinneFixture } from "./htj-helpers";

/**
 * Yhteydenotot (migraatio 0095): osakas aloittaa ketjun omaan huoneistoonsa,
 * isännöinti vastaa, tila päivittyy viesteistä ja kukin näkee vain omansa.
 */

let db: Database;
let f: Fixture;
let r: RinneFixture;
let threadId: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  r = await seedRinne(db, f);
  // Vastuuisännöitsijä ilmoitusta varten.
  await db.asService((tx) => tx.query("update er_housing_companies set manager_user_id = $1 where id = $2", [f.managerA.id, f.companyA]));
});
afterAll(async () => db.close());

const outbox = (subjectId: string) =>
  db.asService((tx) => tx.query<{ recipient: string; subject: string; body: string }>("select recipient, subject, body from er_outbound_messages where subject_id = $1", [subjectId]));

describe("yhteydenotto portaalista", () => {
  it("osakas aloittaa ketjun omaan huoneistoonsa ja isännöitsijä saa ilmoituksen ilman viestin sisältöä", async () => {
    threadId = await db.asUser(r.users.owner.sub, (tx) =>
      createThread(tx, {
        userId: r.users.owner.id,
        companyId: f.companyA,
        shareGroupId: r.groups["A 2"],
        topic: "charges",
        subject: "Vastikelasku syyskuu",
        body: "Syyskuun vastikelaskussa on eri summa kuin elokuussa. Mistä ero johtuu?",
      }),
    );
    const thread = await db.asUser(r.users.owner.sub, (tx) => getThread(tx, threadId));
    expect(thread?.status).toBe("open");
    expect(thread?.message_count).toBe(1);

    const [message] = await db.asService((tx) => tx.query<{ id: string }>("select id from er_contact_messages where thread_id = $1", [threadId]));
    const mails = await outbox(message.id);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Uusi yhteydenotto");
    expect(mails[0].body).not.toContain("elokuussa");
  });

  it("toisen huoneistoon tai vieraaseen yhtiöön ei voi aloittaa ketjua", async () => {
    await expect(
      db.asUser(r.users.owner.sub, (tx) =>
        createThread(tx, { userId: r.users.owner.id, companyId: f.companyA, shareGroupId: r.groups["A 3"], topic: "general", subject: "Naapurin asia", body: "Testi" }),
      ),
    ).rejects.toThrow();
    await expect(
      db.asUser(r.users.owner.sub, (tx) =>
        tx.query(
          "insert into er_contact_threads (organization_id, company_id, created_by_user_id, topic, subject) values ($1,$2,$3,'general','Väärä yhtiö')",
          [f.orgB, f.companyB, r.users.owner.id],
        ),
      ),
    ).rejects.toThrow();
  });

  it("portaalikäyttäjä ei voi merkitä viestiä henkilökunnan viestiksi eikä muuttaa tilaa", async () => {
    await expect(
      db.asUser(r.users.owner.sub, (tx) =>
        tx.query("insert into er_contact_messages (organization_id, thread_id, author_user_id, from_staff, body) values ($1,$2,$3,true,'Vastattu')", [
          f.orgA, threadId, r.users.owner.id,
        ]),
      ),
    ).rejects.toThrow();
    const updated = await db.asUser(r.users.owner.sub, (tx) =>
      tx.query("update er_contact_threads set status = 'closed', closed_at = now() where id = $1 returning id", [threadId]),
    );
    expect(updated).toHaveLength(0);
  });

  it("muut käyttäjät eivät näe ketjua", async () => {
    const veera = await db.asUser(r.users.veera.sub, (tx) => getThread(tx, threadId));
    expect(veera).toBeNull();
    const chair = await db.asUser(r.users.chair.sub, (tx) => tx.query("select id from er_contact_messages where thread_id = $1", [threadId]));
    expect(chair).toHaveLength(0);
    const otherOrg = await db.asUser(f.managerB.sub, (tx) => listStaffThreads(tx, f.orgA, { status: "all" }));
    expect(otherOrg).toHaveLength(0);
    const outsider = await createUser(db);
    await expect(
      db.asUser(outsider.sub, (tx) => postMessage(tx, { threadId, userId: outsider.id, fromStaff: false, body: "Hei" })),
    ).rejects.toBeInstanceOf(ContactError);
  });
});

describe("isännöinnin vastaus", () => {
  it("henkilökunta näkee avoimen ketjun ja vastaa, tila muuttuu ja kysyjä saa ilmoituksen", async () => {
    expect(await db.asUser(f.managerA.sub, (tx) => countOpenThreads(tx, f.orgA))).toBe(1);
    const list = await db.asUser(f.managerA.sub, (tx) => listStaffThreads(tx, f.orgA));
    expect(list.map((t) => t.id)).toEqual([threadId]);

    const replyId = await db.asUser(f.managerA.sub, (tx) =>
      postMessage(tx, { threadId, userId: f.managerA.id, fromStaff: true, body: "Hoitovastike nousi 1.9. yhtiökokouksen päätöksellä." }),
    );
    const thread = await db.asUser(r.users.owner.sub, (tx) => getThread(tx, threadId));
    expect(thread?.status).toBe("answered");
    const mails = await outbox(replyId);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Vastaus yhteydenottoosi");
    expect(mails[0].body).not.toContain("yhtiökokouksen");
  });

  it("kirjanpitäjä saa vastata, portaalikäyttäjä ei esiinny henkilökuntana", async () => {
    await db.asUser(f.accountantA.sub, (tx) => postMessage(tx, { threadId, userId: f.accountantA.id, fromStaff: true, body: "Lisätieto: erittely liitteenä myöhemmin." }));
    await expect(
      db.asUser(r.users.owner.sub, (tx) => postMessage(tx, { threadId, userId: r.users.owner.id, fromStaff: true, body: "Yritys" })),
    ).rejects.toThrow();
  });

  it("osakkaan uusi viesti avaa ketjun, käsitelty sulkee ja uusi viesti avaa uudelleen", async () => {
    await db.asUser(r.users.owner.sub, (tx) => postMessage(tx, { threadId, userId: r.users.owner.id, fromStaff: false, body: "Kiitos, selvä." }));
    expect((await db.asUser(f.managerA.sub, (tx) => getThread(tx, threadId)))?.status).toBe("open");

    await db.asUser(f.managerA.sub, (tx) => setThreadClosed(tx, { threadId, userId: f.managerA.id, closed: true }));
    expect((await db.asUser(r.users.owner.sub, (tx) => getThread(tx, threadId)))?.status).toBe("closed");
    expect(await db.asUser(f.managerA.sub, (tx) => listStaffThreads(tx, f.orgA))).toHaveLength(0);

    await db.asUser(f.managerA.sub, (tx) => setThreadClosed(tx, { threadId, userId: f.managerA.id, closed: false }));
    expect((await db.asUser(f.managerA.sub, (tx) => getThread(tx, threadId)))?.status).toBe("open");

    await db.asUser(f.managerA.sub, (tx) => setThreadClosed(tx, { threadId, userId: f.managerA.id, closed: true }));
    await db.asUser(r.users.owner.sub, (tx) => postMessage(tx, { threadId, userId: r.users.owner.id, fromStaff: false, body: "Vielä yksi kysymys." }));
    expect((await db.asUser(f.managerA.sub, (tx) => getThread(tx, threadId)))?.status).toBe("open");
  });

  it("portaalin lista ja viestit aikajärjestyksessä", async () => {
    const mine = await db.asUser(r.users.owner.sub, (tx) => listPortalThreads(tx, r.users.owner.id));
    expect(mine.map((t) => t.id)).toEqual([threadId]);
    const entries = await db.asUser(r.users.owner.sub, (tx) => listThreadEntries(tx, threadId, r.users.owner.id));
    expect(entries.filter((e) => e.type === "message").map((e) => e.fromStaff)).toEqual([false, true, true, false, false]);
  });
});

describe("yhteydenoton liitteet", () => {
  const insertAttachment = (sub: string, userId: string, opts: { visibility?: string; shareGroupId?: string | null; thread?: string } = {}) =>
    db.asUser(sub, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
            visibility, subject_table, subject_id, uploaded_by)
         values ($1,$2,$3,'other','Yhteydenoton liite','erittely.pdf',$4,'application/pdf',100,'sha',$5,'er_contact_threads',$6,$7) returning id`,
        [f.orgA, f.companyA, opts.shareGroupId === undefined ? r.groups["A 2"] : opts.shareGroupId, `polku/${Math.random()}`, opts.visibility ?? "internal", opts.thread ?? threadId, userId],
      ),
    );

  it("aloittaja liittää tiedoston omaan ketjuunsa ja näkee sen, muut osakkaat eivät", async () => {
    const doc = await insertAttachment(r.users.owner.sub, r.users.owner.id);
    const own = await db.asUser(r.users.owner.sub, (tx) => tx.query("select id from er_documents where id = $1", [doc.id]));
    expect(own).toHaveLength(1);
    const chair = await db.asUser(r.users.chair.sub, (tx) => tx.query("select id from er_documents where id = $1", [doc.id]));
    expect(chair).toHaveLength(0);
    const entries = await db.asUser(r.users.owner.sub, (tx) => listThreadEntries(tx, threadId, r.users.owner.id));
    expect(entries.some((e) => e.type === "attachment" && e.id === doc.id && !e.fromStaff)).toBe(true);
  });

  it("näkyvyyttä ei voi laajentaa eikä liittää toisen huoneistoon", async () => {
    await expect(insertAttachment(r.users.owner.sub, r.users.owner.id, { visibility: "owners" })).rejects.toThrow();
    await expect(insertAttachment(r.users.owner.sub, r.users.owner.id, { shareGroupId: r.groups["A 3"] })).rejects.toThrow();
    await expect(insertAttachment(r.users.veera.sub, r.users.veera.id, { shareGroupId: r.groups["A 3"] })).rejects.toThrow();
  });

  it("henkilökunnan liite näkyy kysyjälle henkilökunnan lähettämänä", async () => {
    const doc = await insertAttachment(f.managerA.sub, f.managerA.id);
    const entries = await db.asUser(r.users.owner.sub, (tx) => listThreadEntries(tx, threadId, r.users.owner.id));
    expect(entries.some((e) => e.type === "attachment" && e.id === doc.id && e.fromStaff)).toBe(true);
  });
});

describe("kysyjän nimi henkilökunnalle", () => {
  it("nimi tulee osapuolirekisteristä, vaikka käyttäjäriviä ei näe", async () => {
    const thread = await db.asUser(f.managerA.sub, (tx) => getThread(tx, threadId));
    expect(thread?.creator_name).toBe("Olli Osakas");
    const entries = await db.asUser(f.managerA.sub, (tx) => listThreadEntries(tx, threadId, r.users.owner.id));
    expect(entries.find((e) => e.type === "message" && !e.fromStaff)?.authorName).toBe("Olli Osakas");
  });
});
