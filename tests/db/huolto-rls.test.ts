import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { addComment, changeStatus, createRequest, orderFromProvider, updateAssignment, type NewRequest } from "@/lib/service-requests/mutations";
import { resolveProviderTask, resolvePublicForm, rotatePublicFormLink } from "@/lib/service-requests/links";
import { hitRateLimit } from "@/lib/service-requests/rate-limit";
import { createAccessLink } from "@/lib/security/access-links";

let db: Database;
let f: Fixture;
let groupA1: string;
let groupA2: string;
let providerA: string;
let owner1: { id: string; sub: string };
let resident2: { id: string; sub: string };
let boardUser: { id: string; sub: string };

const base = (companyId: string, extra: Partial<NewRequest> = {}): NewRequest => ({
  companyId, shareGroupId: null, unitText: null, title: "Hana vuotaa", description: "Keittiön hana tippuu", category: "plumbing",
  urgency: "normal", mayUseMasterKey: false, hasPets: false, source: "staff", reporterUserId: null, reporterName: null,
  reporterPhone: null, reporterEmail: null, ...extra,
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  owner1 = await createUser(db);
  resident2 = await createUser(db);
  boardUser = await createUser(db);
  await db.asService(async (tx) => {
    groupA1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id", [f.orgA, f.companyA])).id;
    groupA2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id", [f.orgA, f.companyA])).id;
    providerA = (await one<{ id: string }>(tx, "insert into er_service_providers (organization_id, name, email, emergency_phone) values ($1,'Huolto A','huolto@example.test','040 1') returning id", [f.orgA])).id;
    await tx.query("insert into er_company_services (organization_id, company_id, provider_id, service, default_for_requests) values ($1,$2,$3,'kiinteistöhuolto',true)", [f.orgA, f.companyA, providerA]);
    await tx.query(
      `insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis) values
         ($1,$2,$3,$4,'owner','test:o1'), ($1,$5,$3,$6,'resident','test:r2'), ($1,$7,$3,null,'board','test:b')`,
      [f.orgA, owner1.id, f.companyA, groupA1, resident2.id, groupA2, boardUser.id],
    );
  });
});
afterAll(async () => db.close());

async function staffCreate(sub: string, companyId: string, extra: Partial<NewRequest> = {}) {
  return db.asUser(sub, (tx) => createRequest(tx, base(companyId, extra)));
}

async function portalCreate(user: { id: string; sub: string }, shareGroupId: string | null, extra: Partial<NewRequest> = {}) {
  return db.asUser(user.sub, (tx) =>
    createRequest(tx, base(f.companyA, { source: "portal", reporterUserId: user.id, shareGroupId, reporterEmail: "ilmoittaja@example.test", ...extra })),
  );
}

describe("huoltopyynnöt: numerointi ja organisaatioeristys", () => {
  it("numero juoksee organisaatiokohtaisesti", async () => {
    const a1 = await staffCreate(f.managerA.sub, f.companyA);
    const a2 = await staffCreate(f.managerA.sub, f.companyA);
    const b1 = await staffCreate(f.managerB.sub, f.companyB);
    expect(a2.number).toBe(a1.number + 1);
    expect(b1.number).toBe(1);
    expect(b1.organizationId).toBe(f.orgB);
  });

  it("toinen organisaatio ei näe, päivitä eikä kommentoi pyyntöjä", async () => {
    const a = await staffCreate(f.managerA.sub, f.companyA);
    const seen = await db.asUser(f.managerB.sub, (tx) => tx.query<{ id: string }>("select id from er_service_requests where id = $1", [a.id]));
    expect(seen).toHaveLength(0);
    const upd = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_service_requests set title = 'kaapattu' where id = $1 returning id", [a.id]));
    expect(upd).toHaveLength(0);
    const events = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_service_request_events where request_id = $1", [a.id]));
    expect(events).toHaveLength(0);
    await expect(
      db.asUser(f.managerB.sub, (tx) => addComment(tx, { requestId: a.id, body: "x", visibility: "internal", actor: { userId: f.managerB.id } })),
    ).rejects.toThrow();
  });

  it("toisen organisaation yhtiöön ei voi luoda pyyntöä", async () => {
    await expect(staffCreate(f.managerA.sub, f.companyB)).rejects.toThrow();
  });

  it("pyyntöä ei voi poistaa", async () => {
    const a = await staffCreate(f.managerA.sub, f.companyA);
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("delete from er_service_requests where id = $1", [a.id]))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("delete from er_service_request_events where request_id = $1", [a.id]))).rejects.toThrow(/permission denied/);
  });

  it("kirjanpitäjä kirjaa kustannuksen mutta ei muuta tilaa", async () => {
    const a = await staffCreate(f.managerA.sub, f.companyA);
    const cost = await db.asUser(f.accountantA.sub, (tx) =>
      tx.query("update er_service_requests set cost_eur = 120.50, cost_responsibility = 'company' where id = $1 returning id", [a.id]),
    );
    expect(cost).toHaveLength(1);
    await expect(
      db.asUser(f.accountantA.sub, (tx) => tx.query("update er_service_requests set status = 'closed' where id = $1", [a.id])),
    ).rejects.toThrow(/only cost fields/);
  });

  it("vastuuhenkilön pitää kuulua organisaatioon", async () => {
    const a = await staffCreate(f.managerA.sub, f.companyA);
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        updateAssignment(tx, { requestId: a.id, assigneeUserId: f.managerB.id, providerId: null, dueOn: null, urgency: "normal", category: "plumbing", shareGroupId: null, actor: { userId: f.managerA.id } }),
      ),
    ).rejects.toThrow(/assignee/);
  });
});

describe("huoltopyynnöt: portaali", () => {
  it("osakas luo pyynnön omaan huoneistoonsa, käsittelytiedot pakotetaan oletuksiin", async () => {
    const r = await portalCreate(owner1, groupA1, { providerId: providerA, assigneeUserId: f.managerA.id });
    const row = await db.asService((tx) =>
      one<{ status: string; provider_id: string | null; assignee_user_id: string | null; reporter_user_id: string; source: string }>(
        tx, "select status, provider_id, assignee_user_id, reporter_user_id, source from er_service_requests where id = $1", [r.id]),
    );
    expect(row).toMatchObject({ status: "new", provider_id: null, assignee_user_id: null, reporter_user_id: owner1.id, source: "portal" });
  });

  it("osakas ei voi luoda pyyntöä toisen huoneistoon eikä toiseen yhtiöön", async () => {
    await expect(portalCreate(owner1, groupA2)).rejects.toThrow();
    await expect(
      db.asUser(owner1.sub, (tx) => createRequest(tx, base(f.companyB, { source: "portal", reporterUserId: owner1.id }))),
    ).rejects.toThrow();
  });

  it("asukas näkee vain omat pyyntönsä, hallitus näkee yhtiön pyynnöt", async () => {
    const own1 = await portalCreate(owner1, groupA1);
    const own2 = await portalCreate(resident2, groupA2);
    const staffMade = await staffCreate(f.managerA.sub, f.companyA);
    await staffCreate(f.managerB.sub, f.companyB);

    const residentSees = await db.asUser(resident2.sub, (tx) => tx.query<{ id: string }>("select id from er_service_requests"));
    expect(ids(residentSees)).toContain(own2.id);
    expect(ids(residentSees)).not.toContain(own1.id);
    expect(ids(residentSees)).not.toContain(staffMade.id);

    const boardSees = await db.asUser(boardUser.sub, (tx) => tx.query<{ id: string; company_id: string }>("select id, company_id from er_service_requests"));
    expect(ids(boardSees)).toEqual(expect.arrayContaining([own1.id, own2.id, staffMade.id]));
    expect(boardSees.every((r) => r.company_id === f.companyA)).toBe(true);
  });

  it("portaalikäyttäjä ei näe sisäisiä tapahtumia; hallitus näkee hallituksen tapahtumat", async () => {
    const r = await portalCreate(owner1, groupA1);
    await db.asUser(f.managerA.sub, async (tx) => {
      await addComment(tx, { requestId: r.id, body: "sisäinen", visibility: "internal", actor: { userId: f.managerA.id } });
      await addComment(tx, { requestId: r.id, body: "ilmoittajalle", visibility: "reporter", actor: { userId: f.managerA.id } });
      await addComment(tx, { requestId: r.id, body: "hallitukselle", visibility: "board", actor: { userId: f.managerA.id } });
      await addComment(tx, { requestId: r.id, body: "huollolle", visibility: "provider", actor: { userId: f.managerA.id } });
    });
    const bodies = async (sub: string) =>
      (await db.asUser(sub, (tx) => tx.query<{ body: string | null }>("select body from er_service_request_events where request_id = $1", [r.id])))
        .map((e) => e.body)
        .filter(Boolean);
    expect(await bodies(owner1.sub)).toEqual(["ilmoittajalle"]);
    expect((await bodies(boardUser.sub)).sort()).toEqual(["hallitukselle", "ilmoittajalle"]);
    expect(await bodies(resident2.sub)).toEqual([]);
    expect((await bodies(f.managerA.sub)).length).toBe(4);
  });

  it("ilmoittaja ei voi kirjata sisäistä kommenttia eikä päivittää pyyntöä suoraan", async () => {
    const r = await portalCreate(owner1, groupA1);
    await expect(
      db.asUser(owner1.sub, (tx) => addComment(tx, { requestId: r.id, body: "x", visibility: "internal", actor: { userId: owner1.id } })),
    ).rejects.toThrow(/row-level security/);
    await db.asUser(owner1.sub, (tx) => addComment(tx, { requestId: r.id, body: "lisätietoa", visibility: "reporter", actor: { userId: owner1.id } }));
    const upd = await db.asUser(owner1.sub, (tx) => tx.query("update er_service_requests set status = 'closed' where id = $1 returning id", [r.id]));
    expect(upd).toHaveLength(0);
  });

  it("ilmoittaja kuittaa valmiin suljetuksi ja avaa uudelleen kommentilla", async () => {
    const r = await portalCreate(owner1, groupA1);
    const act = (sub: string, action: string, comment: string | null) =>
      db.asUser(sub, (tx: Sql) => tx.query("select er_service_request_reporter_action($1, $2, $3)", [r.id, action, comment]));

    await expect(act(owner1.sub, "close", null)).rejects.toThrow(/invalid transition/);
    await db.asUser(f.managerA.sub, (tx) => changeStatus(tx, { requestId: r.id, to: "done", actor: { userId: f.managerA.id }, mode: "staff" }));
    await expect(act(resident2.sub, "close", null)).rejects.toThrow(/not found/);
    await expect(act(owner1.sub, "reopen", "  ")).rejects.toThrow(/comment required/);
    await act(owner1.sub, "close", null);
    await act(owner1.sub, "reopen", "Vuotaa edelleen");

    const row = await db.asService((tx) =>
      one<{ status: string; reopened_count: number; closed_at: unknown }>(tx, "select status, reopened_count, closed_at from er_service_requests where id = $1", [r.id]),
    );
    expect(row).toMatchObject({ status: "received", reopened_count: 1, closed_at: null });
    const messages = await db.asService((tx) => tx.query<{ subject: string; body: string }>("select subject, body from er_outbound_messages where subject_id = $1", [r.id]));
    // Ilmoitus lähtee henkilökunnan tekemästä tilamuutoksesta, ei ilmoittajan omasta.
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toContain("Valmis");
    expect(messages[0].body).not.toContain("Keittiön hana tippuu");
  });

  it("ilmoittaja näkee oman kuvansa, muut asukkaat eivät; hallitus näkee", async () => {
    const r = await portalCreate(owner1, groupA1);
    const [doc] = await db.asUser(owner1.sub, (tx) =>
      tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, subject_table, subject_id, uploaded_by)
         values ($1,$2,'photo','kuva','kuva.jpg',$3,'image/jpeg',10,'x','reporter','er_service_requests',$4,$5) returning id`,
        [f.orgA, f.companyA, `test/${r.id}`, r.id, owner1.id],
      ),
    );
    const sees = async (sub: string) => (await db.asUser(sub, (tx) => tx.query("select id from er_documents where id = $1", [doc.id]))).length;
    expect(await sees(owner1.sub)).toBe(1);
    expect(await sees(boardUser.sub)).toBe(1);
    expect(await sees(resident2.sub)).toBe(0);
    expect(await sees(f.managerB.sub)).toBe(0);
    await expect(
      db.asUser(resident2.sub, (tx) =>
        tx.query(
          `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, subject_table, subject_id, uploaded_by)
           values ($1,$2,'photo','kuva','kuva.jpg',$3,'image/jpeg',10,'x','reporter','er_service_requests',$4,$5)`,
          [f.orgA, f.companyA, `test2/${r.id}`, r.id, resident2.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("päivystysnumero näkyy vain oman yhtiön portaalikäyttäjälle", async () => {
    const mine = await db.asUser(owner1.sub, (tx) => tx.query<{ emergency_phone: string }>("select * from er_portal_emergency_contacts()"));
    expect(mine.map((m) => m.emergency_phone)).toEqual(["040 1"]);
    const other = await db.asUser(f.managerB.sub, (tx) => tx.query("select * from er_portal_emergency_contacts()"));
    expect(other).toHaveLength(0);
  });
});

describe("huoltopyynnöt: linkit ja kutsurajoitin", () => {
  it("tilaus luo tehtävälinkin ja viestin; linkki toimii vain voimassa ollessaan", async () => {
    const r = await staffCreate(f.managerA.sub, f.companyA, { providerId: providerA });
    let token = "";
    await db.asUser(f.managerA.sub, async (tx) => {
      await orderFromProvider(tx, { requestId: r.id, actor: { userId: f.managerA.id } });
    });
    // Token on vain sähköpostissa; poimitaan se jonosta testiä varten.
    const [msg] = await db.asService((tx) => tx.query<{ body: string; recipient: string }>("select body, recipient from er_outbound_messages where subject_id = $1", [r.id]));
    expect(msg.recipient).toBe("huolto@example.test");
    token = /\/tehtava\/([A-Za-z0-9_-]+)/.exec(msg.body)![1];

    const task = await db.asService((tx) => resolveProviderTask(tx, token));
    expect(task?.requestId).toBe(r.id);
    expect(task?.status).toBe("ordered");

    // Palveluntuottajan vaihto mitätöi linkin.
    await db.asUser(f.managerA.sub, (tx) =>
      updateAssignment(tx, { requestId: r.id, assigneeUserId: null, providerId: null, dueOn: null, urgency: "normal", category: "plumbing", shareGroupId: null, actor: { userId: f.managerA.id } }),
    );
    expect(await db.asService((tx) => resolveProviderTask(tx, token))).toBeNull();
  });

  it("palveluntuottajan kuittaus kirjataan provider_actor-merkinnällä; käyttäjä ei voi väärentää sitä", async () => {
    const r = await staffCreate(f.managerA.sub, f.companyA, { providerId: providerA, reporterEmail: "a@example.test" });
    await db.asService((tx) => changeStatus(tx, { requestId: r.id, to: "in_progress", actor: { userId: null, providerActor: true }, mode: "provider" }));
    const [ev] = await db.asService((tx) =>
      tx.query<{ provider_actor: boolean; user_id: string | null }>("select provider_actor, user_id from er_service_request_events where request_id = $1 and new_status = 'in_progress'", [r.id]),
    );
    expect(ev).toEqual({ provider_actor: true, user_id: null });

    await db.asUser(f.managerA.sub, (tx) =>
      tx.query("insert into er_service_request_events (request_id, type, body, visibility, user_id, provider_actor) values ($1,'comment','x','internal',$2,true)", [r.id, f.managerA.id]),
    );
    const forged = await db.asService((tx) => tx.query<{ provider_actor: boolean }>("select provider_actor from er_service_request_events where request_id = $1 and body = 'x'", [r.id]));
    expect(forged[0].provider_actor).toBe(false);
  });

  it("vanhentunut linkki ei avaudu", async () => {
    const r = await staffCreate(f.managerA.sub, f.companyA, { providerId: providerA });
    const token = await db.asUser(f.managerA.sub, (tx) =>
      createAccessLink(tx, { organizationId: f.orgA, purpose: "provider_task", subjectTable: "er_service_requests", subjectId: r.id, expiresInDays: 30 }),
    );
    expect(await db.asService((tx) => resolveProviderTask(tx, token))).not.toBeNull();
    await db.asService((tx) => tx.query("update er_access_links set expires_at = now() - interval '1 minute' where subject_id = $1", [r.id]));
    expect(await db.asService((tx) => resolveProviderTask(tx, token))).toBeNull();
  });

  it("väärän tarkoituksen linkki ei avaa tehtävää", async () => {
    const form = await db.asUser(f.managerA.sub, (tx) => rotatePublicFormLink(tx, { companyId: f.companyA, userId: f.managerA.id }));
    expect(await db.asService((tx) => resolveProviderTask(tx, form))).toBeNull();
    expect((await db.asService((tx) => resolvePublicForm(tx, form)))?.companyId).toBe(f.companyA);
  });

  it("lomakelinkin vaihto mitätöi vanhan", async () => {
    const first = await db.asUser(f.managerA.sub, (tx) => rotatePublicFormLink(tx, { companyId: f.companyA, userId: f.managerA.id }));
    const second = await db.asUser(f.managerA.sub, (tx) => rotatePublicFormLink(tx, { companyId: f.companyA, userId: f.managerA.id }));
    expect(await db.asService((tx) => resolvePublicForm(tx, first))).toBeNull();
    expect(await db.asService((tx) => resolvePublicForm(tx, second))).not.toBeNull();
    // Toisen organisaation isännöitsijä ei voi luoda linkkiä yhtiölle.
    await expect(db.asUser(f.managerB.sub, (tx) => rotatePublicFormLink(tx, { companyId: f.companyA, userId: f.managerB.id }))).rejects.toThrow();
  });

  it("julkinen lomake luo pyynnön palvelun roolilla ilman ilmoittajan käyttäjää", async () => {
    const r = await db.asService((tx) => createRequest(tx, base(f.companyA, { source: "public_form", unitText: "B 12", reporterName: "Testi" })));
    const row = await db.asService((tx) => one<{ source: string; organization_id: string; reporter_user_id: string | null }>(tx, "select source, organization_id, reporter_user_id from er_service_requests where id = $1", [r.id]));
    expect(row).toMatchObject({ source: "public_form", organization_id: f.orgA, reporter_user_id: null });
  });

  it("kutsurajoitin päästää viisi tunnissa ja on vain palvelun luettavissa", async () => {
    const now = new Date("2026-09-15T10:15:00Z");
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await db.asService((tx) => hitRateLimit(tx, { organizationId: f.orgA, bucket: "public_form:abc", limit: 5, windowMinutes: 60, now })));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    const nextHour = await db.asService((tx) => hitRateLimit(tx, { organizationId: f.orgA, bucket: "public_form:abc", limit: 5, windowMinutes: 60, now: new Date("2026-09-15T11:01:00Z") }));
    expect(nextHour.allowed).toBe(true);
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("select * from er_rate_limits"))).rejects.toThrow(/permission denied/);
  });
});
