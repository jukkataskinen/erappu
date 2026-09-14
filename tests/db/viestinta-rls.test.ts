import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { resolveRecipients } from "@/lib/announcements/recipients";
import { publishAnnouncement } from "@/lib/announcements/publish";
import { listDocuments } from "@/lib/documents/queries";
import { listPortalAnnouncements, markRead } from "@/lib/announcements/queries";

let db: Database;
let f: Fixture;
type U = { id: string; sub: string };
let owner1: U; // osakas, huoneisto g1 (rakennus B1)
let owner2: U; // naapuri, huoneisto g2 (rakennus B2)
let tenant1: U; // vuokralainen, huoneisto g1
let boardUser: U; // hallituksen jäsen, myös g2:n osakas
let g1: string;
let g2: string;
let b1: string;
let b2: string;
let docs: Record<string, string>;

async function doc(tx: Sql, title: string, visibility: string, shareGroupId: string | null = null, subject: string | null = null) {
  const r = await one<{ id: string }>(
    tx,
    `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, subject_table)
     values ($1,$2,$3,'other',$4,'a.pdf',$5,'application/pdf',10,'x',$6,$7) returning id`,
    [f.orgA, f.companyA, shareGroupId, title, `test/${title}-${Math.random()}`, visibility, subject],
  );
  return r.id;
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner1 = await createUser(db);
  owner2 = await createUser(db);
  tenant1 = await createUser(db);
  boardUser = await createUser(db);

  await db.asService(async (tx) => {
    b1 = (await one<{ id: string }>(tx, "insert into er_buildings (organization_id, company_id, label) values ($1,$2,'A') returning id", [f.orgA, f.companyA])).id;
    b2 = (await one<{ id: string }>(tx, "insert into er_buildings (organization_id, company_id, label) values ($1,$2,'B') returning id", [f.orgA, f.companyA])).id;
    g1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, building_id) values ($1,$2,'A 1',$3) returning id", [f.orgA, f.companyA, b1])).id;
    g2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, building_id) values ($1,$2,'B 1',$3) returning id", [f.orgA, f.companyA, b2])).id;
    const g3 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'C 1') returning id", [f.orgA, f.companyA])).id;

    const party = async (last: string, email: string | null, userId: string | null) =>
      (await one<{ id: string }>(tx, "insert into er_parties (organization_id, last_name, email, user_id) values ($1,$2,$3,$4) returning id", [f.orgA, last, email, userId])).id;
    const p1 = await party("Yksi", "Yksi@Example.test", owner1.id);
    const p2 = await party("Kaksi", "kaksi@example.test", owner2.id);
    const pt = await party("Vuokralainen", "vuokra@example.test", tenant1.id);
    const pb = await party("Hallitus", "hallitus@example.test", boardUser.id);
    const pSpouse = await party("Puoliso", "yksi@example.test", null); // sama osoite kuin p1
    const pNoEmail = await party("Ilman", null, null);

    await tx.query(
      `insert into er_ownerships (organization_id, share_group_id, party_id, source) values
        ($1,$2,$4,'manual'), ($1,$2,$7,'manual'), ($1,$3,$5,'manual'), ($1,$3,$6,'manual'), ($1,$8,$9,'manual')`,
      [f.orgA, g1, g2, p1, p2, pb, pSpouse, g3, pNoEmail],
    );
    await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,'tenant')", [f.orgA, g1, pt]);
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2020-01-01')", [f.orgA, f.companyA, pb]);
    for (const g of [g1, g2, g3]) await syncPortalAccessForGroup(tx, g);
    await syncPortalAccessForBoard(tx, f.companyA);

    docs = {
      internal: await doc(tx, "sisainen", "internal"),
      board: await doc(tx, "hallitus", "board"),
      owners: await doc(tx, "osakkaat", "owners"),
      residents: await doc(tx, "asukkaat", "residents"),
      g1Owners: await doc(tx, "g1-osakkaat", "owners", g1),
      g1Residents: await doc(tx, "g1-asukkaat", "residents", g1),
      g2Owners: await doc(tx, "g2-osakkaat", "owners", g2),
      attachment: await doc(tx, "liite", "internal", null, "er_service_requests"),
    };
    await tx.query(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility)
       values ($1,$2,'articles','B:n yhtiöjärjestys','b.pdf','test/b','application/pdf',1,'x','residents')`,
      [f.orgB, f.companyB],
    );
  });
});
afterAll(async () => db.close());

const visibleDocs = (u: U) => db.asUser(u.sub, (tx) => tx.query<{ id: string }>("select id from er_documents")).then((r) => new Set(r.map((x) => x.id)));

async function announce(values: { audience?: string[]; buildings?: string[] | null; status?: string; validUntil?: string | null; channels?: string[] }) {
  return db.asService(async (tx) =>
    (
      await one<{ id: string }>(
        tx,
        `insert into er_announcements (organization_id, company_id, title, body, audience_roles, building_ids, channels, status, published_at, valid_until)
         values ($1,$2,'Tiedote','Sisältö',$3,$4,$5,$6, case when $6 = 'draft' then null else now() end, $7) returning id`,
        [f.orgA, f.companyA, values.audience ?? ["owner", "resident"], values.buildings ?? null, values.channels ?? ["portal"], values.status ?? "published", values.validUntil ?? null],
      )
    ).id,
  );
}

const canSeeAnnouncement = (u: U, id: string) =>
  db.asUser(u.sub, (tx) => tx.query("select id from er_announcements where id = $1", [id])).then((r) => r.length === 1);

describe("dokumenttien näkyvyys", () => {
  it("toinen organisaatio ei näe dokumentteja", async () => {
    const seen = await visibleDocs(f.managerB);
    for (const id of Object.values(docs)) expect(seen.has(id)).toBe(false);
    expect(seen.size).toBe(1);
  });

  it("asukas ei näe osakkaille tarkoitettua dokumenttia, mutta näkee asukkaille tarkoitetun", async () => {
    const seen = await visibleDocs(tenant1);
    expect(seen.has(docs.owners)).toBe(false);
    expect(seen.has(docs.residents)).toBe(true);
    expect(seen.has(docs.internal)).toBe(false);
    expect(seen.has(docs.board)).toBe(false);
  });

  it("vuokralainen näkee huoneistonsa asukasdokumentin mutta ei huoneiston osakasdokumenttia", async () => {
    const seen = await visibleDocs(tenant1);
    expect(seen.has(docs.g1Residents)).toBe(true);
    expect(seen.has(docs.g1Owners)).toBe(false);
  });

  it("osakas näkee oman huoneistonsa dokumentin mutta ei naapurin", async () => {
    const seen = await visibleDocs(owner1);
    expect(seen.has(docs.g1Owners)).toBe(true);
    expect(seen.has(docs.owners)).toBe(true);
    expect(seen.has(docs.g2Owners)).toBe(false);
    expect(seen.has(docs.board)).toBe(false);
  });

  it("hallitus näkee hallituksen dokumentin mutta ei sisäistä", async () => {
    const seen = await visibleDocs(boardUser);
    expect(seen.has(docs.board)).toBe(true);
    expect(seen.has(docs.internal)).toBe(false);
  });

  it("listaus piilottaa liitteet oletuksena", async () => {
    const rows = await db.asUser(f.managerA.sub, (tx) => listDocuments(tx, { organizationId: f.orgA }));
    expect(rows.some((r) => r.id === docs.attachment)).toBe(false);
    const all = await db.asUser(f.managerA.sub, (tx) => listDocuments(tx, { organizationId: f.orgA, includeAttachments: true }));
    expect(all.some((r) => r.id === docs.attachment)).toBe(true);
  });

  it("haku ei tulkitse %-merkkiä jokerimerkiksi", async () => {
    const rows = await db.asUser(f.managerA.sub, (tx) => listDocuments(tx, { organizationId: f.orgA, q: "%" }));
    expect(rows).toHaveLength(0);
  });

  it("kirjanpitäjä voi muokata mutta ei poistaa, isännöitsijä voi poistaa", async () => {
    const upd = await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_documents set year = 2025 where id = $1 returning id", [docs.internal]));
    expect(upd).toHaveLength(1);
    const del = await db.asUser(f.accountantA.sub, (tx) => tx.query("delete from er_documents where id = $1 returning id", [docs.internal]));
    expect(del).toHaveLength(0);
    const delB = await db.asUser(f.managerB.sub, (tx) => tx.query("delete from er_documents where id = $1 returning id", [docs.internal]));
    expect(delB).toHaveLength(0);
    const delA = await db.asUser(f.managerA.sub, (tx) => tx.query("delete from er_documents where id = $1 returning id", [docs.internal]));
    expect(delA).toHaveLength(1);
  });
});

describe("tiedotteiden näkyvyys", () => {
  it("toinen organisaatio ei näe tiedotteita", async () => {
    const id = await announce({});
    expect(await canSeeAnnouncement(f.managerA, id)).toBe(true);
    expect(await canSeeAnnouncement(f.managerB, id)).toBe(false);
  });

  it("asukas ei näe hallitukselle kohdistettua tiedotetta, hallitus näkee", async () => {
    const id = await announce({ audience: ["board"] });
    expect(await canSeeAnnouncement(tenant1, id)).toBe(false);
    expect(await canSeeAnnouncement(owner1, id)).toBe(false);
    expect(await canSeeAnnouncement(boardUser, id)).toBe(true);
  });

  it("osakastiedote näkyy osakkaalle mutta ei vuokralaiselle", async () => {
    const id = await announce({ audience: ["owner"] });
    expect(await canSeeAnnouncement(owner1, id)).toBe(true);
    expect(await canSeeAnnouncement(tenant1, id)).toBe(false);
  });

  it("rakennusrajaus: B-talon osakas ei näe A-talon tiedotetta", async () => {
    const id = await announce({ audience: ["owner", "resident"], buildings: [b1] });
    expect(await canSeeAnnouncement(owner1, id)).toBe(true);
    expect(await canSeeAnnouncement(tenant1, id)).toBe(true);
    expect(await canSeeAnnouncement(owner2, id)).toBe(false);
  });

  it("luonnos ja vanhentunut tiedote eivät näy osakkaalle", async () => {
    const draft = await announce({ status: "draft" });
    const expired = await announce({ validUntil: "2020-01-01" });
    expect(await canSeeAnnouncement(owner1, draft)).toBe(false);
    expect(await canSeeAnnouncement(owner1, expired)).toBe(false);
    // Henkilökunnan luonnos ei näy hallitukselle.
    expect(await canSeeAnnouncement(boardUser, draft)).toBe(false);
  });

  it("hallitus voi luoda vain luonnoksen omaan yhtiöönsä", async () => {
    const insert = (u: U, status: string, company = f.companyA, org = f.orgA) =>
      db.asUser(u.sub, (tx) =>
        tx.query<{ id: string }>(
          `insert into er_announcements (organization_id, company_id, title, body, status, origin, author_user_id, published_at)
           values ($1,$2,'Ehdotus','Teksti',$3,'board',$4, case when $3 = 'draft' then null else now() end) returning id`,
          [org, company, status, u.id],
        ),
      );
    const [draft] = await insert(boardUser, "draft");
    expect(draft.id).toBeTruthy();
    await expect(insert(boardUser, "published")).rejects.toThrow(/row-level security/);
    await expect(insert(owner1, "draft")).rejects.toThrow(/row-level security/);
    await expect(insert(boardUser, "draft", f.companyB, f.orgB)).rejects.toThrow(/row-level security/);

    // Julkaisu päivittämällä ei onnistu.
    await expect(
      db.asUser(boardUser.sub, (tx) => tx.query("update er_announcements set status = 'published', published_at = now() where id = $1", [draft.id])),
    ).rejects.toThrow(/row-level security/);
    // Oman luonnoksen muokkaus onnistuu.
    const upd = await db.asUser(boardUser.sub, (tx) => tx.query("update er_announcements set title = 'Uusi' where id = $1 returning id", [draft.id]));
    expect(upd).toHaveLength(1);
    // Isännöitsijä näkee hallituksen luonnoksen.
    expect(await canSeeAnnouncement(f.managerA, draft.id)).toBe(true);
  });

  it("luetuksi merkintä onnistuu vain näkyvälle tiedotteelle", async () => {
    const visible = await announce({ audience: ["resident"] });
    const hidden = await announce({ audience: ["board"] });
    await db.asUser(tenant1.sub, (tx) => markRead(tx, visible, tenant1.id));
    await db.asUser(tenant1.sub, (tx) => markRead(tx, hidden, tenant1.id));
    const reads = await db.asService((tx) => tx.query<{ announcement_id: string }>("select announcement_id from er_announcement_reads where user_id = $1", [tenant1.id]));
    expect(reads.map((r) => r.announcement_id)).toEqual([visible]);
    // Toisen käyttäjän nimissä ei voi kuitata.
    await expect(
      db.asUser(tenant1.sub, (tx) =>
        tx.query("insert into er_announcement_reads (announcement_id, user_id, organization_id) values ($1,$2,$3)", [visible, owner1.id, f.orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
    const list = await db.asUser(tenant1.sub, (tx) => listPortalAnnouncements(tx, tenant1.id, [f.companyA], { unreadOnly: true }));
    expect(list.some((a) => a.id === visible)).toBe(false);
  });
});

describe("vastaanottajat ja julkaisu", () => {
  it("poistaa päällekkäiset osoitteet ja laskee sähköpostittomat", async () => {
    const r = await db.asUser(f.managerA.sub, (tx) => resolveRecipients(tx, { companyId: f.companyA, audienceRoles: ["owner", "resident", "board"], buildingIds: null }));
    // Osapuolet: p1, p2, pt, pb, puoliso, ilman sähköpostia = 6
    expect(r.partyCount).toBe(6);
    // p1 ja puoliso jakavat osoitteen (kirjainkoko eri), pb on sekä osakas että hallitus.
    expect(r.emailRecipients.map((x) => x.email).sort()).toEqual(["hallitus@example.test", "kaksi@example.test", "vuokra@example.test", "yksi@example.test"]);
    expect(r.emailRecipients.find((x) => x.email === "hallitus@example.test")?.roles.sort()).toEqual(["board", "owner"]);
    expect(r.withoutEmailCount).toBe(1);
    expect(r.portalUserCount).toBe(4);
  });

  it("rakennusrajaus koskee osakkaita ja asukkaita mutta ei hallitusta", async () => {
    const r = await db.asUser(f.managerA.sub, (tx) => resolveRecipients(tx, { companyId: f.companyA, audienceRoles: ["owner", "resident", "board"], buildingIds: [b1] }));
    expect(r.emailRecipients.map((x) => x.email).sort()).toEqual(["hallitus@example.test", "vuokra@example.test", "yksi@example.test"]);
    const owners = await db.asUser(f.managerA.sub, (tx) => resolveRecipients(tx, { companyId: f.companyA, audienceRoles: ["owner"], buildingIds: [b2] }));
    expect(owners.emailRecipients.map((x) => x.email).sort()).toEqual(["hallitus@example.test", "kaksi@example.test"]);
  });

  it("julkaisu kirjaa sähköpostit jonoon kerran ja vain luonnokselle", async () => {
    const id = await announce({ status: "draft", audience: ["owner"], channels: ["portal", "email"] });
    const res = await db.asUser(f.managerA.sub, (tx) => publishAnnouncement(tx, { id, userId: f.managerA.id, appBaseUrl: "https://erappu.test" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.queued).toBe(3); // yksi@ (p1 + puoliso), kaksi@, hallitus@
    expect(res.report.withoutEmailCount).toBe(1);
    const msgs = await db.asUser(f.managerA.sub, (tx) =>
      tx.query<{ body: string; status: string }>("select body, status from er_outbound_messages where subject_table = 'er_announcements' and subject_id = $1", [id]),
    );
    expect(msgs).toHaveLength(3);
    expect(msgs[0].body).toContain(`https://erappu.test/portaali/tiedotteet/${id}`);
    const again = await db.asUser(f.managerA.sub, (tx) => publishAnnouncement(tx, { id, userId: f.managerA.id }));
    expect(again).toEqual({ ok: false, reason: "not_draft" });
    // Toisen organisaation isännöitsijä ei löydä tiedotetta.
    const other = await announce({ status: "draft" });
    const denied = await db.asUser(f.managerB.sub, (tx) => publishAnnouncement(tx, { id: other, userId: f.managerB.id }));
    expect(denied).toEqual({ ok: false, reason: "not_found" });
  });

  it("portaalikanava ilman sähköpostia ei kirjaa viestejä", async () => {
    const id = await announce({ status: "draft", audience: ["resident"], channels: ["portal"] });
    const res = await db.asUser(f.managerA.sub, (tx) => publishAnnouncement(tx, { id, userId: f.managerA.id }));
    expect(res.ok && res.report.queued).toBe(0);
  });
});
