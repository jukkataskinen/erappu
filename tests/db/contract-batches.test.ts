import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { BatchError, cancelBatch, createBatch, generateBatch, renewBatch, sendBatch, setBatchCompanies, updateBatchItems, type Actor, type BatchDeps } from "@/lib/contract-templates/batches";
import { getBatch, listBatchItems } from "@/lib/contract-templates/queries";
import { processSigningEvent } from "@/lib/signing/process";
import { EsinettiMockClient, completeMockRound, resetMockEsinetti } from "@/lib/esinetti/mock";
import type { EsinettiClient, Round, WebhookEvent } from "@/lib/esinetti";
import type { StoredFile } from "@/lib/storage";

let db: Database;
let f: Fixture;
let board: { id: string; sub: string };
let company2: string;
let company3: string;
let providerA: string;
let providerB: string;

const files = new Map<string, Buffer>();
const deps: BatchDeps = {
  today: "2026-09-15",
  store: async (opts) => {
    const storagePath = `${opts.organizationId}/${randomUUID()}/${opts.fileName}`;
    files.set(storagePath, opts.bytes);
    return { storagePath, fileName: opts.fileName, mimeType: opts.mimeType, sizeBytes: opts.bytes.length, sha256: createHash("sha256").update(opts.bytes).digest("hex") } satisfies StoredFile;
  },
  remove: async (p) => void files.delete(p),
  read: async (p) => {
    const b = files.get(p);
    if (!b) throw new Error("ei tiedostoa");
    return b;
  },
};

const runAs = (sub: string) => <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(sub, fn);
let manager: Actor;

function completedEvent(round: Round, id = `evt-${randomUUID()}`): WebhookEvent {
  return {
    id,
    event: "round.completed",
    createdAt: new Date().toISOString(),
    roundId: round.id,
    externalRef: round.externalRef,
    status: round.status,
    signers: round.signers.map((s) => ({ id: s.id, name: s.name, email: s.email, roleLabel: s.roleLabel, status: s.status, openedAt: s.openedAt, identifiedAt: s.identifiedAt, signedAt: s.signedAt, declinedAt: s.declinedAt })),
    documents: round.documents.map((d) => ({ id: d.id, name: d.name, sealedSha256: d.sealedSha256, downloadUrl: null })),
  };
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  board = await createUser(db);
  manager = { userId: f.managerA.id, organizationId: f.orgA, canManage: true };
  await db.asService(async (tx) => {
    company2 = (await one<{ id: string }>(tx, "insert into er_housing_companies (organization_id, name, business_id, street_address, postal_code, city, manager_user_id) values ($1,'As Oy Kakkonen','2222222-2','Kakkostie 2','41660','Toivakka',$2) returning id", [f.orgA, f.managerA.id])).id;
    company3 = (await one<{ id: string }>(tx, "insert into er_housing_companies (organization_id, name, business_id, street_address, postal_code, city, manager_user_id) values ($1,'As Oy Kolmonen','3333333-3','Kolmostie 3','19650','Joutsa',$2) returning id", [f.orgA, f.managerA.id])).id;
    await tx.query("update er_housing_companies set street_address = 'Ykköstie 1', postal_code = '41660', city = 'Toivakka' where id = $1", [f.companyA]);
    const chair = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Paula','Puheenjohtaja','paula@example.test') returning id", [f.orgA])).id;
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2026-01-01')", [f.orgA, f.companyA, chair]);
    providerA = (await one<{ id: string }>(tx, "insert into er_service_providers (organization_id, name, business_id, email) values ($1,'Aurausliike Oy','4444444-4','aura@example.test') returning id", [f.orgA])).id;
    providerB = (await one<{ id: string }>(tx, "insert into er_service_providers (organization_id, name, email) values ($1,'Toisen Aura Oy','b@example.test') returning id", [f.orgB])).id;
    await tx.query("insert into er_portal_access (organization_id, user_id, company_id, role, basis) values ($1,$2,$3,'board','test')", [f.orgA, board.id, f.companyA]);
  });
});
afterAll(async () => db.close());
// Mockin kierrokset säilyvät testistä toiseen, koska kulku jatkuu testien yli.
beforeAll(() => resetMockEsinetti());

const shared = { valid_until: "2027-04-30", price_ploughing: "45", price_sanding: "40,5" };

describe("sopimuserät: RLS", () => {
  let batchId: string;
  beforeAll(async () => {
    batchId = await createBatch(runAs(f.managerA.sub), manager, { templateKey: "snow-ploughing", title: "RLS-erä", providerId: providerA, sharedRaw: shared, companyIds: [f.companyA] }, deps);
  });

  it("toinen organisaatio ei näe eikä muokkaa erää", async () => {
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_contract_batches"))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_contract_batch_items"))).toHaveLength(0);
    expect(await db.asUser(f.managerB.sub, (tx) => tx.query("update er_contract_batches set title = 'x' where id = $1 returning id", [batchId]))).toHaveLength(0);
    await expect(
      createBatch(runAs(f.managerB.sub), { userId: f.managerB.id, organizationId: f.orgB, canManage: true }, { templateKey: "snow-ploughing", title: "x", providerId: providerA, sharedRaw: {}, companyIds: [] }, deps),
    ).rejects.toThrow(BatchError);
  });

  it("kirjanpitäjä lukee mutta ei kirjoita", async () => {
    expect(await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_contract_batches"))).toHaveLength(1);
    expect(await db.asUser(f.accountantA.sub, (tx) => tx.query("update er_contract_batches set title = 'x' where id = $1 returning id", [batchId]))).toHaveLength(0);
    await expect(
      db.asUser(f.accountantA.sub, (tx) => tx.query("insert into er_contract_batches (organization_id, template_key, template_version, title) values ($1,'snow-ploughing',1,'x')", [f.orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("rivi ei voi osoittaa toisen organisaation yhtiöön eikä erä toisen organisaation urakoitsijaan", async () => {
    await expect(
      db.asUser(f.managerA.sub, (tx) => tx.query(`insert into er_contract_batch_items (organization_id, batch_id, company_id) values ($1,$2,$3)`, [f.orgA, batchId, f.companyB])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(f.managerA.sub, (tx) => tx.query("update er_contract_batches set provider_id = $2 where id = $1", [batchId, providerB])),
    ).rejects.toThrow(/row-level security/);
    // Toisen organisaation yhtiö jätetään valinnassa huomiotta.
    await setBatchCompanies(runAs(f.managerA.sub), manager, batchId, [f.companyA, f.companyB], deps);
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(items.map((i) => i.company_id)).toEqual([f.companyA]);
  });

  it("hallitus näkee oman yhtiönsä rivit, ei eriä", async () => {
    expect(await db.asUser(board.sub, (tx) => tx.query("select id from er_contract_batch_items"))).toHaveLength(1);
    expect(await db.asUser(board.sub, (tx) => tx.query("select id from er_contract_batches"))).toHaveLength(0);
  });
});

describe("sopimuserät: koko kulku mock-eSinetillä", () => {
  let batchId: string;
  const client = new EsinettiMockClient();

  it("luonti esitäyttää edustajat ja osoitteet rekisteristä", async () => {
    batchId = await createBatch(runAs(f.managerA.sub), manager, { templateKey: "snow-ploughing", title: "Lumityösopimukset 2026–2027", providerId: providerA, sharedRaw: shared, companyIds: [f.companyA, company2, company3] }, deps);
    const batch = await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId));
    expect(batch?.shared_values).toMatchObject({ price_ploughing: "45.00", price_sanding: "40.50", provider_representative: "Aurausliike Oy", provider_representative_email: "aura@example.test" });
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(items).toHaveLength(3);
    const a = items.find((i) => i.company_id === f.companyA)!;
    expect(a.values).toMatchObject({ client_representative: "Paula Puheenjohtaja", client_representative_email: "paula@example.test", site_address: "Ykköstie 1, 41660 Toivakka", ploughing: true, sanding: true });
    const k = items.find((i) => i.company_id === company2)!;
    // Puheenjohtajaa ei ole → vastuuisännöitsijä (testikäyttäjällä ei nimeä, joten sähköposti).
    expect(k.values.client_representative_email).toMatch(/@example\.test$/);
  });

  it("validointivirhe estää koko muodostuksen", async () => {
    await updateBatchItems(runAs(f.managerA.sub), manager, batchId, { [company3]: { client_representative_email: "" } });
    await expect(generateBatch(runAs(f.managerA.sub), manager, batchId, deps)).rejects.toMatchObject({ details: ["As Oy Kolmonen: tilaajan edustajan sähköposti puuttuu"] });
    expect(await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_contracts where company_id = any($1::uuid[])", [[f.companyA, company2, company3]]))).toHaveLength(0);
    expect(files.size).toBe(0);
    await updateBatchItems(runAs(f.managerA.sub), manager, batchId, { [company3]: { client_representative_email: "kolmonen@example.test", sanding: "ei", price_ploughing: "55" } });
  });

  it("muodostus luo sopimukset ja dokumentit, uudelleenmuodostus korvaa luonnoksen", async () => {
    expect(await generateBatch(runAs(f.managerA.sub), manager, batchId, deps)).toBe(3);
    const contracts = await db.asUser(f.managerA.sub, (tx) =>
      tx.query<{ id: string; counterparty: string; ends_on: string; notice_months: number; document_id: string; description: string; company_id: string }>(
        "select id, counterparty, to_char(ends_on,'YYYY-MM-DD') as ends_on, notice_months, document_id, description, company_id from er_contracts where company_id = any($1::uuid[])", [[f.companyA, company2, company3]]),
    );
    expect(contracts).toHaveLength(3);
    expect(contracts.every((c) => c.counterparty === "Aurausliike Oy" && c.ends_on === "2027-04-30" && c.notice_months === 1)).toBe(true);
    expect(contracts.find((c) => c.company_id === company3)!.description).toContain("hiekoitus ei");
    expect(contracts.find((c) => c.company_id === company3)!.description).toContain("55,00 €/kerta");
    const docs = await db.asUser(f.managerA.sub, (tx) => tx.query<{ title: string; visibility: string; category: string }>("select title, visibility, category from er_documents where subject_table = 'er_contract_batch_items'"));
    expect(docs).toHaveLength(3);
    expect(docs[0]).toMatchObject({ title: "Lumityösopimus Aurausliike Oy 30.4.2027", visibility: "board", category: "contract" });
    expect(files.size).toBe(3);

    const before = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    await generateBatch(runAs(f.managerA.sub), manager, batchId, deps);
    const after = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(after.map((i) => i.contract_id).sort()).toEqual(before.map((i) => i.contract_id).sort());
    expect(after.some((i) => before.some((b) => b.document_id === i.document_id))).toBe(false);
    expect(await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_documents where subject_table = 'er_contract_batch_items'"))).toHaveLength(3);
    expect(files.size).toBe(3);
    expect((await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId)))?.status).toBe("generated");
  });

  it("kirjanpitäjä ei voi lähettää, isännöitsijä lähettää kolme kierrosta", async () => {
    await expect(sendBatch(runAs(f.accountantA.sub), { userId: f.accountantA.id, organizationId: f.orgA, canManage: false }, batchId, client, {}, deps)).rejects.toThrow(BatchError);
    const result = await sendBatch(runAs(f.managerA.sub), manager, batchId, client, {}, deps);
    expect(result).toEqual({ sent: 3, failed: [] });
    const rounds = await db.asUser(f.managerA.sub, (tx) => tx.query<{ signers: { role: string }[]; subject_table: string }>("select signers, subject_table from er_signing_rounds"));
    expect(rounds).toHaveLength(3);
    expect(rounds[0].signers.map((s) => s.role)).toEqual(["Tilaajan edustaja", "Urakoitsija"]);
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(items.every((i) => i.status === "sent")).toBe(true);
    expect((await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId)))?.status).toBe("sent");
  });

  it("webhook: allekirjoitus yhdelle, idempotenssi, loput → erä valmis", async () => {
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    const roundIds = await db.asService((tx) => tx.query<{ esinetti_round_id: string; subject_id: string }>("select esinetti_round_id, subject_id from er_signing_rounds where subject_table = 'er_contract_batch_items'"));
    const sealStore: BatchDeps["store"] = deps.store!;
    const first = items[0];
    const round = completeMockRound(roundIds.find((r) => r.subject_id === first.id)!.esinetti_round_id);
    const event = completedEvent(round);
    expect(await processSigningEvent(db, event, JSON.stringify(event), { client, store: sealStore, remove: deps.remove })).toBe("processed");
    expect(await processSigningEvent(db, event, JSON.stringify(event), { client, store: sealStore, remove: deps.remove })).toBe("duplicate");
    // Uusi tapahtuma-id samalle valmiille kierrokselle ei käsittele uudelleen.
    const again = completedEvent(round);
    expect(await processSigningEvent(db, again, JSON.stringify(again), { client, store: sealStore, remove: deps.remove })).toBe("ignored");

    const signed = await db.asUser(f.managerA.sub, (tx) => tx.query<{ status: string; sealed_document_id: string; contract_document: string }>(
      "select i.status, i.sealed_document_id, k.document_id as contract_document from er_contract_batch_items i join er_contracts k on k.id = i.contract_id where i.id = $1", [first.id]));
    expect(signed[0].status).toBe("signed");
    expect(signed[0].contract_document).toBe(signed[0].sealed_document_id);
    const sealedDocs = await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_documents where sealed and subject_id = $1", [first.id]));
    expect(sealedDocs).toHaveLength(1);
    // Hallitus näkee sinetöidyn, ei enää luonnosta.
    const boardDocs = await db.asUser(board.sub, (tx) => tx.query<{ sealed: boolean }>("select sealed from er_documents where subject_id = $1", [first.id]));
    if (first.company_id === f.companyA) expect(boardDocs).toEqual([{ sealed: true }]);
    expect((await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId)))?.status).toBe("sent");

    for (const item of items.slice(1)) {
      const r = completeMockRound(roundIds.find((x) => x.subject_id === item.id)!.esinetti_round_id);
      const e = completedEvent(r);
      expect(await processSigningEvent(db, e, JSON.stringify(e), { client, store: sealStore, remove: deps.remove })).toBe("processed");
    }
    expect((await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId)))?.status).toBe("completed");
    const audits = await db.asService((tx) => tx.query("select id from er_audit_log where action = 'contract_signed'"));
    expect(audits).toHaveLength(3);
  });

  it("uusinta kopioi arvot ja siirtää voimassaolon vuodella", async () => {
    // Hallitus vaihtuu: Kolmoselle tulee puheenjohtaja.
    await db.asService(async (tx) => {
      const p = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name, email) values ($1,'Uusi','Puheenjohtaja','uusi@example.test') returning id", [f.orgA])).id;
      await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2026-06-01')", [f.orgA, company3, p]);
    });
    const nextId = await renewBatch(runAs(f.managerA.sub), manager, batchId, deps);
    const next = await db.asUser(f.managerA.sub, (tx) => getBatch(tx, nextId));
    expect(next).toMatchObject({ title: "Lumityösopimukset 2027–2028", status: "draft", previous_batch_id: batchId, provider_id: providerA });
    expect(next?.shared_values).toMatchObject({ valid_until: "2028-04-30", price_ploughing: "45.00", price_sanding: "40.50" });
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, nextId));
    expect(items).toHaveLength(3);
    const k3 = items.find((i) => i.company_id === company3)!;
    expect(k3.values).toMatchObject({ sanding: false, price_ploughing: "55.00", client_representative: "Uusi Puheenjohtaja", client_representative_email: "uusi@example.test" });
  });
});

describe("sopimuserät: lähetyksen virheet ja peruminen", () => {
  it("yhden yhtiön kierroksen epäonnistuminen ei estä muita, peruminen poistaa allekirjoittamattomat", async () => {
    const batchId = await createBatch(runAs(f.managerA.sub), manager, { templateKey: "snow-ploughing", title: "Virhe-erä", providerId: providerA, sharedRaw: shared, companyIds: [f.companyA, company2] }, deps);
    await generateBatch(runAs(f.managerA.sub), manager, batchId, deps);
    const mock = new EsinettiMockClient();
    let calls = 0;
    const flaky = {
      createRound: async (input: Parameters<EsinettiClient["createRound"]>[0]) => {
        if (calls++ === 0) throw new Error("verkko");
        return mock.createRound(input);
      },
      cancelRound: (id: string) => mock.cancelRound(id),
    } as unknown as EsinettiClient;
    const result = await sendBatch(runAs(f.managerA.sub), manager, batchId, flaky, {}, deps);
    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([{ companyName: expect.any(String), error: "Allekirjoituskierroksen luonti epäonnistui." }]);
    const items = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(items.map((i) => i.status).sort()).toEqual(["error", "sent"]);

    // Allekirjoittaja hylkää → rivi hylätyksi, kierros ei valmistu.
    const sent = items.find((i) => i.status === "sent")!;
    const [roundRow] = await db.asService((tx) => tx.query<{ esinetti_round_id: string }>("select esinetti_round_id from er_signing_rounds where id = $1", [sent.signing_round_id]));
    const remote = await mock.getRound(roundRow.esinetti_round_id);
    const declined: WebhookEvent = { ...completedEvent(remote), event: "signer.declined", signers: completedEvent(remote).signers.map((s, i) => (i === 0 ? { ...s, status: "declined" } : s)) };
    expect(await processSigningEvent(db, declined, JSON.stringify(declined), { client: mock })).toBe("processed");
    const afterDecline = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(afterDecline.find((i) => i.id === sent.id)?.status).toBe("declined");

    await cancelBatch(runAs(f.managerA.sub), manager, batchId, mock, deps);
    const after = await db.asUser(f.managerA.sub, (tx) => listBatchItems(tx, batchId));
    expect(after.every((i) => i.status === "cancelled" && !i.contract_id && !i.document_id)).toBe(true);
    const contractIds = items.map((i) => i.contract_id);
    expect(await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_contracts where id = any($1::uuid[])", [contractIds]))).toHaveLength(0);
    expect((await db.asUser(f.managerA.sub, (tx) => getBatch(tx, batchId)))?.status).toBe("cancelled");
  });
});
