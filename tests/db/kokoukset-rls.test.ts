import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { createMeeting, moveItem, prefillAttendees } from "@/lib/meetings/mutations";
import { listItems, listMeetings } from "@/lib/meetings/queries";
import { processSigningEvent } from "@/lib/meetings/signing";
import { EsinettiMockClient, completeMockRound, resetMockEsinetti } from "@/lib/esinetti/mock";
import type { WebhookEvent } from "@/lib/esinetti";
import { loadManagerCertificateData, renderManagerCertificate } from "@/lib/certificates/manager-certificate";
import type { StoredFile } from "@/lib/storage";

let db: Database;
let f: Fixture;
let owner: { id: string; sub: string };
let board: { id: string; sub: string };
let generalA: string;
let draftA: string;
let boardA: string;
let generalB: string;
let groupA1: string;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner = await createUser(db);
  board = await createUser(db);
  await db.asService(async (tx) => {
    groupA1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1', 54.5) returning id", [f.orgA, f.companyA])).id;
    const g2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,600),($1,$2,$4,601,1000)", [f.orgA, f.companyA, groupA1, g2]);
    const p1 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email, electronic_notice_consent, user_id) values ($1,'Olli','Osakas','olli@example.test',true,$2) returning id", [f.orgA, owner.id])).id;
    const p2 = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name) values ($1,'Pekka','Paperi') returning id", [f.orgA])).id;
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual'),($1,$4,$5,'manual')", [f.orgA, groupA1, p1, g2, p2]);
    await tx.query(
      "insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values ($1,$2,$3,$4,'owner','test'),($1,$5,$3,null,'board','test')",
      [f.orgA, owner.id, f.companyA, groupA1, board.id],
    );
    await tx.query("insert into er_charge_bases (organization_id, company_id, charge_type, basis, unit_price, starts_on) values ($1,$2,'maintenance','area_m2',4.2,'2020-01-01')", [f.orgA, f.companyA]);
  });
});
afterAll(async () => db.close());

describe("kokousten RLS", () => {
  beforeAll(async () => {
    // createMeeting kirjoittaa created_by-viittauksen, joten luodaan kokoukset isännöitsijänä.
    const make = async (companyId: string, kind: "annual_general" | "board", status: string, sub: string, userId: string) => {
      const m = await db.asUser(sub, (tx) =>
        createMeeting(tx, { companyId, kind, startsAt: new Date(Date.now() + 20 * 86400000).toISOString(), location: "Kerhohuone", remoteParticipation: false, remoteUrl: null, fiscalYear: "2026", createdBy: userId }),
      );
      if (!m) throw new Error("ei luotu");
      await db.asService((tx) => tx.query("update er_meetings set status = $2 where id = $1", [m.id, status]));
      return m.id;
    };
    generalA = await make(f.companyA, "annual_general", "notice_sent", f.managerA.sub, f.managerA.id);
    draftA = await make(f.companyA, "annual_general", "draft", f.managerA.sub, f.managerA.id);
    boardA = await make(f.companyA, "board", "notice_sent", f.managerA.sub, f.managerA.id);
    generalB = await make(f.companyB, "annual_general", "notice_sent", f.managerB.sub, f.managerB.id);
  });

  it("kokous saa asialistan pohjasta ja asioita voi siirtää", async () => {
    const items = await db.asUser(f.managerA.sub, (tx) => listItems(tx, generalA));
    expect(items[0].title).toBe("Kokouksen avaus");
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
    await db.asUser(f.managerA.sub, (tx) => moveItem(tx, generalA, items[1].id, "up"));
    const moved = await db.asUser(f.managerA.sub, (tx) => listItems(tx, generalA));
    expect(moved[0].id).toBe(items[1].id);
    expect(moved[1].id).toBe(items[0].id);
  });

  it("henkilökunta näkee vain oman organisaationsa kokoukset", async () => {
    const a = await db.asUser(f.managerA.sub, (tx) => listMeetings(tx));
    expect(a.map((m) => m.id).sort()).toEqual([generalA, draftA, boardA].sort());
    const b = await db.asUser(f.managerB.sub, (tx) => listMeetings(tx));
    expect(b.map((m) => m.id)).toEqual([generalB]);
    const hijack = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_meetings set location = 'x' where id = $1 returning id", [generalA]));
    expect(hijack).toHaveLength(0);
    const items = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_meeting_items where meeting_id = $1", [generalA]));
    expect(items).toHaveLength(0);
  });

  it("toiseen organisaatioon ei voi lisätä kokousta", async () => {
    const r = await db.asUser(f.managerB.sub, (tx) =>
      createMeeting(tx, { companyId: f.companyA, kind: "board", startsAt: new Date().toISOString(), location: null, remoteParticipation: false, remoteUrl: null, fiscalYear: null, createdBy: f.managerB.id }),
    );
    expect(r).toBeNull();
    await expect(
      db.asUser(f.managerB.sub, (tx) => tx.query("insert into er_meetings (organization_id, company_id, kind, starts_at) values ($1,$2,'board',now())", [f.orgA, f.companyA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("kirjanpitäjä lukee mutta ei muokkaa kokouksia", async () => {
    const read = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_meetings"));
    expect(read.length).toBe(3);
    const upd = await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_meetings set location = 'x' where id = $1 returning id", [generalA]));
    expect(upd).toHaveLength(0);
  });

  it("osakas näkee kutsutun yhtiökokouksen, ei luonnosta eikä hallituksen kokousta", async () => {
    const rows = await db.asUser(owner.sub, (tx) => listMeetings(tx));
    expect(rows.map((m) => m.id)).toEqual([generalA]);
    const items = await db.asUser(owner.sub, (tx) => tx.query<{ meeting_id: string }>("select meeting_id from er_meeting_items"));
    expect(new Set(items.map((i) => i.meeting_id))).toEqual(new Set([generalA]));
    const attendees = await db.asUser(owner.sub, (tx) => tx.query("select id from er_meeting_attendees"));
    expect(attendees).toHaveLength(0);
  });

  it("hallitus näkee yhtiön kokoukset (ei luonnoksia) ja ääniluettelon", async () => {
    await db.asUser(f.managerA.sub, (tx) => prefillAttendees(tx, generalA));
    const rows = await db.asUser(board.sub, (tx) => listMeetings(tx));
    expect(rows.map((m) => m.id).sort()).toEqual([generalA, boardA].sort());
    const attendees = await db.asUser(board.sub, (tx) => tx.query<{ display_name: string; shares: number }>("select display_name, shares from er_meeting_attendees order by display_name"));
    expect(attendees).toEqual([
      { display_name: "Olli Osakas", shares: 600 },
      { display_name: "Pekka Paperi", shares: 400 },
    ]);
  });

  it("webhook-tapahtumat ja todistustilaukset eivät näy portaalille eikä toiselle organisaatiolle", async () => {
    await db.asService((tx) =>
      tx.query("insert into er_certificate_orders (organization_id, company_id, share_group_id, orderer_name, orderer_email, price_eur) values ($1,$2,$3,'Välittäjä','v@example.test',120)", [f.orgA, f.companyA, groupA1]),
    );
    expect(await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_certificate_orders"))).toHaveLength(1);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_certificate_orders"))).toHaveLength(0);
    expect(await db.asUser(owner.sub, (tx) => tx.query("select id from er_certificate_orders"))).toHaveLength(0);
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("select * from er_webhook_events"))).rejects.toThrow(/permission denied/);
  });
});

describe("pöytäkirjan allekirjoitus: webhookin käsittely", () => {
  it("round.completed tallentaa sinetöidyn PDF:n kerran ja merkitsee pöytäkirjan allekirjoitetuksi", async () => {
    resetMockEsinetti();
    const client = new EsinettiMockClient();
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n% testi\n"));
    const round = await client.createRound({
      title: "Pöytäkirja",
      documents: [{ name: "poytakirja.pdf", pdfBytes: pdf }],
      signers: [{ name: "Pj", email: "pj@example.test" }, { name: "Tarkastaja", email: "t@example.test" }],
      externalRef: `erappu:meeting:${generalA}`,
      send: true,
    });
    await db.asService((tx) =>
      tx.query(
        `insert into er_signing_rounds (organization_id, company_id, subject_table, subject_id, esinetti_round_id, status, signers)
         values ($1,$2,'er_meetings',$3,$4,'sent',$5)`,
        [f.orgA, f.companyA, generalA, round.id, JSON.stringify([{ name: "Pj", email: "pj@example.test", role: "Puheenjohtaja" }, { name: "Tarkastaja", email: "t@example.test", role: "Pöytäkirjantarkastaja" }])],
      ),
    );
    const done = completeMockRound(round.id);

    const stored: string[] = [];
    const removed: string[] = [];
    const store = async (opts: { fileName: string; bytes: Buffer; mimeType: string }): Promise<StoredFile> => {
      const storagePath = `test/${stored.length}/${opts.fileName}`;
      stored.push(storagePath);
      return { storagePath, sha256: "x".repeat(64), sizeBytes: opts.bytes.length, mimeType: opts.mimeType, fileName: opts.fileName };
    };
    const remove = async (p: string) => {
      removed.push(p);
    };
    const event: WebhookEvent = {
      id: "evt-complete-1",
      event: "round.completed",
      createdAt: new Date().toISOString(),
      roundId: round.id,
      externalRef: `erappu:meeting:${generalA}`,
      status: "completed",
      signers: done.signers.map((s) => ({ ...s, roleLabel: s.roleLabel })),
      documents: done.documents.map((d) => ({ id: d.id, name: d.name, sealedSha256: d.sealedSha256, downloadUrl: null })),
    };

    expect(await processSigningEvent(db, event, JSON.stringify(event), { client, store, remove })).toBe("processed");
    expect(await processSigningEvent(db, event, JSON.stringify(event), { client, store, remove })).toBe("duplicate");
    // Sama kierros uudella tapahtuma-id:llä: ei toista dokumenttia.
    expect(await processSigningEvent(db, { ...event, id: "evt-complete-2" }, "{}", { client, store, remove })).toBe("ignored");

    const docs = await db.asService((tx) => tx.query<{ sealed: boolean; visibility: string }>("select sealed, visibility from er_documents where subject_id = $1 and sealed", [generalA]));
    expect(docs).toEqual([{ sealed: true, visibility: "owners" }]);
    expect(stored).toHaveLength(1);
    const [m] = await db.asService((tx) => tx.query<{ status: string }>("select status from er_meetings where id = $1", [generalA]));
    expect(m.status).toBe("minutes_signed");
    const [r] = await db.asService((tx) => tx.query<{ status: string; sealed_document_id: string | null }>("select status, sealed_document_id from er_signing_rounds where esinetti_round_id = $1", [round.id]));
    expect(r.status).toBe("completed");
    expect(r.sealed_document_id).not.toBeNull();
    // Osakas näkee sinetöidyn pöytäkirjan.
    const ownerDocs = await db.asUser(owner.sub, (tx) => tx.query("select id from er_documents where subject_id = $1 and sealed", [generalA]));
    expect(ownerDocs).toHaveLength(1);
  });

  it("tuntematon kierros tai väärä kohdetunniste ohitetaan muuttamatta mitään", async () => {
    const client = new EsinettiMockClient();
    const base: WebhookEvent = {
      id: "evt-unknown", event: "round.completed", createdAt: new Date().toISOString(), roundId: "ei-ole", externalRef: `erappu:meeting:${boardA}`,
      status: "completed", signers: [], documents: [],
    };
    expect(await processSigningEvent(db, base, "{}", { client })).toBe("ignored");
    expect(await processSigningEvent(db, base, "{}", { client })).toBe("duplicate");
    const [m] = await db.asService((tx) => tx.query<{ status: string }>("select status from er_meetings where id = $1", [boardA]));
    expect(m.status).toBe("notice_sent");
  });
});

describe("isännöitsijäntodistus", () => {
  it("kokoaa tiedot ilman maksutilannetaulua ja renderöi luonnoksen", async () => {
    const data = await db.asUser(f.managerA.sub, async (tx) => {
      const d = await loadManagerCertificateData(tx, groupA1, { issuedOn: "2026-09-15" });
      // Transaktio on yhä käyttökelpoinen maksutilannekyselyn jälkeen.
      await tx.query("select 1");
      return d;
    });
    expect(data).not.toBeNull();
    expect(data!.unit).toMatchObject({ label: "A 1", shareCount: 600, shareRanges: "1–600" });
    expect(data!.finance.charges[0].monthly).toBe("228,90 €");
    expect(data!.finance.paymentStatus).toBeNull();
    expect(data!.approved).toBe(false);
    const pdf = await renderManagerCertificate(data!);
    expect(Buffer.from(pdf.bytes.subarray(0, 4)).toString("latin1")).toBe("%PDF");
    // Toisen organisaation isännöitsijä ei saa tietoja.
    expect(await db.asUser(f.managerB.sub, (tx) => loadManagerCertificateData(tx, groupA1))).toBeNull();
  });

  it("maksutilanne luetaan M3:n taulusta, ja rikkinäinen kysely ei kaada transaktiota", async () => {
    // Taulu ilman odotettua saraketta: kysely epäonnistuu tallennuspisteen sisällä.
    await db.exec("create table er_payment_status (id int); grant select on er_payment_status to authenticated;");
    const broken = await db.asUser(f.managerA.sub, async (tx) => {
      const d = await loadManagerCertificateData(tx, groupA1);
      await tx.query("select 1");
      return d;
    });
    expect(broken?.finance.paymentStatus).toBeNull();

    await db.exec(`drop table er_payment_status;
      create table er_payment_status (share_group_id uuid, overdue_eur numeric, as_of date);
      grant select on er_payment_status to authenticated;
      insert into er_payment_status values ('${groupA1}', 35.5, '2026-09-01');`);
    const ok = await db.asUser(f.managerA.sub, (tx) => loadManagerCertificateData(tx, groupA1));
    expect(ok?.finance.paymentStatus).toBe("Erääntyneitä maksuja 35,50 € (tilanne 1.9.2026).");
    await db.exec("drop table er_payment_status;");
  });
});
