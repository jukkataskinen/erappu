import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import { makePdf, makePng } from "../helpers/pdf-fixtures";
import type { Database, Sql } from "@/lib/db/types";
import type { StoredFile } from "@/lib/storage";
import { generateCertificateForOrder, saveOrderOptions, type CertificateStorageDeps } from "@/lib/certificates/orders";
import { parseStoredEntries } from "@/lib/certificates/attachments";
import { CertificateError } from "@/lib/certificates/assemble";
import { sealCertificateOrder } from "@/lib/certificates/sealing";
import { EsinettiMockClient, resetMockEsinetti } from "@/lib/esinetti/mock";
import { buildExternalRef, parseExternalRef } from "@/lib/esinetti";
import { createHash } from "node:crypto";

let db: Database;
let f: Fixture;
let groupA: string;
const files = new Map<string, Uint8Array>();
let counter = 0;

const deps: CertificateStorageDeps = {
  store: async (opts) => {
    const storagePath = `mem/${counter++}/${opts.fileName}`;
    files.set(storagePath, new Uint8Array(opts.bytes));
    return { storagePath, sha256: `sha-${counter}`, sizeBytes: opts.bytes.length, mimeType: opts.mimeType, fileName: opts.fileName } satisfies StoredFile;
  },
  remove: async (p) => void files.delete(p),
  read: async (p) => {
    const b = files.get(p);
    if (!b) throw new Error("ei löydy");
    return b;
  },
};

const runAs = (sub: string) => <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(sub, fn);

async function addDoc(category: string, path: string, bytes: Uint8Array, mime: string, shareGroupId: string | null = null) {
  files.set(path, bytes);
  await db.asService((tx) =>
    tx.query(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, year)
       values ($1,$2,$3,$4,$5,'x',$6,$7,$8,'s',2025)`,
      [f.orgA, f.companyA, shareGroupId, category, category, path, mime, bytes.length],
    ),
  );
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    groupA = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1',54.5) returning id", [f.orgA, f.companyA])).id;
    await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,1,100)", [f.orgA, f.companyA, groupA]);
  });
  await addDoc("articles", "docs/yj.pdf", await makePdf(3, "Yhtiöjärjestys"), "application/pdf");
  await addDoc("budget", "docs/ta.pdf", await makePdf(1, "Talousarvio"), "application/pdf");
  await addDoc("floor_plan", "docs/pk.png", makePng(200, 120), "image/png", groupA);
});
afterAll(async () => db.close());

async function newOrder(withAttachments: boolean) {
  return db.asService(async (tx) =>
    (await one<{ id: string }>(
      tx,
      `insert into er_certificate_orders (organization_id, company_id, share_group_id, orderer_name, orderer_email, price_eur, with_attachments, purpose)
       values ($1,$2,$3,'Testi Tilaaja','tilaaja@example.test',120,$4,'sale') returning id`,
      [f.orgA, f.companyA, groupA, withAttachments],
    )).id,
  );
}

describe("isännöitsijäntodistus liitteineen (kanta)", () => {
  it("muodostaa yhden PDF:n, tallentaa liiteluettelon ja merkitsee puuttuvat", async () => {
    const orderId = await newOrder(true);
    const result = await generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, deps);
    expect(result).not.toBeNull();
    expect(result!.warnings.join(" ")).toContain("Tilinpäätös");
    const [order] = await db.asUser(f.managerA.sub, (tx) =>
      tx.query<{ attachments: unknown; status: string; document_id: string }>("select attachments, status, document_id from er_certificate_orders where id = $1", [orderId]),
    );
    expect(order.status).toBe("in_progress");
    const entries = parseStoredEntries(order.attachments);
    expect(entries.map((e) => [e.key, e.status])).toEqual([
      ["articles", "attached"],
      ["financial_statement", "missing"],
      ["budget", "attached"],
      ["floor_plan", "attached"],
      ["energy_certificate", "missing"],
      ["maintenance_needs_report", "missing"],
    ]);
    const [doc] = await db.asUser(f.managerA.sub, (tx) => tx.query<{ storage_path: string; title: string; visibility: string }>("select storage_path, title, visibility from er_documents where id = $1", [order.document_id]));
    expect(doc.title).toContain("liitteineen");
    expect(doc.visibility).toBe("internal");
    const merged = await PDFDocument.load(files.get(doc.storage_path)!);
    // Todistus (vähintään 1 s.) + (1+3) + (1+1) + (1+1)
    expect(merged.getPageCount()).toBeGreaterThanOrEqual(1 + 4 + 2 + 2);
  });

  it("laatija poistaa liitteen, ja toinen organisaatio ei voi muuttaa eikä muodostaa", async () => {
    const orderId = await newOrder(true);
    expect(await db.asUser(f.managerB.sub, (tx) => saveOrderOptions(tx, f.managerB.id, orderId, { withAttachments: true, excluded: ["articles"], purpose: null, purposeText: null, price: null }))).toBe(false);
    expect(await generateCertificateForOrder(runAs(f.managerB.sub), f.managerB.id, orderId, deps)).toBeNull();
    expect(
      await db.asUser(f.managerA.sub, (tx) => saveOrderOptions(tx, f.managerA.id, orderId, { withAttachments: true, excluded: ["articles", "tuntematon"], purpose: "bank", purposeText: null, price: 150 })),
    ).toBe(true);
    const [o] = await db.asService((tx) => tx.query<{ excluded_attachments: string[]; price_eur: string }>("select excluded_attachments, price_eur::text from er_certificate_orders where id = $1", [orderId]));
    expect(o.excluded_attachments).toEqual(["articles"]);
    expect(o.price_eur).toBe("150.00");
    await generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, deps);
    const [after] = await db.asService((tx) => tx.query<{ attachments: unknown }>("select attachments from er_certificate_orders where id = $1", [orderId]));
    const entries = parseStoredEntries(after.attachments);
    expect(entries[0]).toMatchObject({ number: 1, key: "financial_statement" });
    expect(entries.some((e) => e.key === "articles")).toBe(false);
  });

  it("sinetöinti eSinetin mockilla korvaa sinetöimättömän version ja estää uudelleenmuodostuksen", async () => {
    resetMockEsinetti();
    const client = new EsinettiMockClient();
    const orderId = await newOrder(true);
    const generated = await generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, deps);
    const [before] = await db.asService((tx) => tx.query<{ storage_path: string }>("select storage_path from er_documents where id = $1", [generated!.documentId]));

    // Kirjanpitäjä ei voi sinetöidä: sinetöimättömän version poisto vaatii isännöitsijän (RLS), ja koko muutos perutaan.
    await expect(sealCertificateOrder(runAs(f.accountantA.sub), f.accountantA.id, orderId, { client, ...deps })).rejects.toThrow();
    const [stillOpen] = await db.asService((tx) => tx.query<{ sealed_at: string | null }>("select sealed_at from er_certificate_orders where id = $1", [orderId]));
    expect(stillOpen.sealed_at).toBeNull();

    const sealed = await sealCertificateOrder(runAs(f.managerA.sub), f.managerA.id, orderId, { client, ...deps });
    const [order] = await db.asService((tx) => tx.query<{ document_id: string; sealed_at: string | null }>("select document_id, sealed_at from er_certificate_orders where id = $1", [orderId]));
    expect(order.document_id).toBe(sealed.documentId);
    expect(order.sealed_at).not.toBeNull();
    const [doc] = await db.asService((tx) => tx.query<{ sealed: boolean; storage_path: string; title: string }>("select sealed, storage_path, title from er_documents where id = $1", [sealed.documentId]));
    expect(doc.sealed).toBe(true);
    expect(doc.title).toContain("sinetöity");
    // Sinetöimätön versio poistettiin kannasta ja varastosta.
    expect(await db.asService((tx) => tx.query("select id from er_documents where id = $1", [generated!.documentId]))).toHaveLength(0);
    expect(files.has(before.storage_path)).toBe(false);
    const [round] = await db.asService((tx) =>
      tx.query<{ status: string; sealed_document_id: string }>("select status, sealed_document_id from er_signing_rounds where subject_table = 'er_certificate_orders' and subject_id = $1", [orderId]),
    );
    expect(round).toMatchObject({ status: "completed", sealed_document_id: sealed.documentId });
    // Aitoustarkistus: eSinetti löytää sinetöidyn tiedoston tiivisteellä.
    const verify = await client.verifyDocument(createHash("sha256").update(files.get(doc.storage_path)!).digest("hex"));
    expect(verify.found).toBe(true);
    await expect(generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, deps)).rejects.toBeInstanceOf(CertificateError);
    await expect(sealCertificateOrder(runAs(f.managerA.sub), f.managerA.id, orderId, { client, ...deps })).rejects.toThrow("jo sinetöity");
    expect(parseExternalRef(buildExternalRef("certificate", orderId))).toEqual({ kind: "certificate", id: orderId });
  });

  it("ilman liitteitä -todistus ei lue liitetiedostoja", async () => {
    const orderId = await newOrder(false);
    const result = await generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, {
      ...deps,
      read: async () => {
        throw new Error("ei saa lukea");
      },
    });
    expect(result?.warnings).toEqual([]);
    const [o] = await db.asService((tx) => tx.query<{ attachments: unknown }>("select attachments from er_certificate_orders where id = $1", [orderId]));
    expect(parseStoredEntries(o.attachments).find((e) => e.key === "articles")?.status).toBe("available");
  });

  // 0116: isännöinti päättää hinnan itse, joten tilaus voi olla hinnoittelematta.
  it("tilauksen voi tallentaa ilman hintaa", async () => {
    const orderId = await db.asService(async (tx) =>
      (await one<{ id: string }>(
        tx,
        `insert into er_certificate_orders (organization_id, company_id, share_group_id, orderer_name, orderer_email, with_attachments, purpose)
         values ($1,$2,$3,'Testi Tilaaja','tilaaja@example.test',false,'sale') returning id`,
        [f.orgA, f.companyA, groupA],
      )).id,
    );
    const [o] = await db.asService((tx) => tx.query<{ price_eur: string | null }>("select price_eur::text from er_certificate_orders where id = $1", [orderId]));
    expect(o.price_eur).toBeNull();
    const result = await generateCertificateForOrder(runAs(f.managerA.sub), f.managerA.id, orderId, deps);
    expect(result).not.toBeNull();
  });
});
