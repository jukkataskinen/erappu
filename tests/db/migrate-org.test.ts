import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database } from "@/lib/db/types";
import {
  applyMigrationPlan,
  buildMigrationPlan,
  checkFiles,
  ExistingDataError,
  productionEnv,
  summarizePlan,
  uploadFiles,
  type RawSql,
} from "@/lib/deploy/migrate-org";

/*
  Siirto paikallisesta kannasta tuotantoon: kaksi PGlite-kantaa (lähde ja kohde)
  keksityllä datalla. Kohteessa on vain bootstrap-ownerin jälki, kuten tuotannossa.
*/

const BID = "2237131-2";
const SRC_ORG = "11111111-1111-4111-8111-111111111111";
const DEMO_ORG = "22222222-2222-4222-8222-222222222222";
const TGT_ORG = "33333333-3333-4333-8333-333333333333";
const JUKKA = "44444444-4444-4444-8444-444444444444";
const KIRJANPITAJA = "55555555-5555-4555-8555-555555555555";
const DEMO_USER = "66666666-6666-4666-8666-666666666666";
const OWNER = "77777777-7777-4777-8777-777777777777";
const COMPANY = "88888888-8888-4888-8888-888888888888";
const DEMO_COMPANY = "99999999-9999-4999-8999-999999999999";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RANGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARTY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOC1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BATCH1 = "f0000000-0000-4000-8000-000000000001";
const BATCH2 = "f0000000-0000-4000-8000-000000000002";

// Taulu ilman organisaatiosaraketta: siirtyy FK-ketjun kautta (er_share_ranges → organisaatio).
const EXTRA_TABLE = `create table er_test_range_notes (
  id uuid primary key default gen_random_uuid(),
  share_range_id uuid not null references er_share_ranges(id) on delete cascade,
  note text not null);
  grant select on er_test_range_notes to authenticated, service_role;`;

async function rawDb(): Promise<{ pg: PGlite; sql: RawSql }> {
  const pg = await PGlite.create({ extensions: { btree_gist } });
  const sql: RawSql = { query: async (t, p) => (await pg.query(t, p as never[])).rows as never[] };
  const db = {
    exec: async (s: string) => void (await pg.exec(s)),
    asService: (fn: (tx: RawSql) => Promise<unknown>) => fn(sql),
  } as unknown as Database;
  await migrateLocal(db);
  await pg.exec(EXTRA_TABLE);
  return { pg, sql };
}

let src: { pg: PGlite; sql: RawSql };
let tgt: { pg: PGlite; sql: RawSql };
let filesRoot: string;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const count = async (db: RawSql, text: string, params: unknown[] = []) => (await db.query<{ n: number }>(`select count(*)::int as n from ${text}`, params))[0].n;

beforeAll(async () => {
  [src, tgt] = await Promise.all([rawDb(), rawDb()]);
  filesRoot = await mkdtemp(path.join(tmpdir(), "erappu-migrate-files-"));

  const pdf = Buffer.from("%PDF-1.4 yhtiojarjestys");
  const pic = Buffer.from("%PDF-1.4 pohjapiirustus");
  const path1 = `${SRC_ORG}/${COMPANY}/0f000000-0000-4000-8000-000000000001/yhtiojarjestys.pdf`;
  const path2 = `${SRC_ORG}/_/0f000000-0000-4000-8000-000000000002/pohja.pdf`;
  await mkdir(path.join(filesRoot, path.dirname(path1)), { recursive: true });
  await writeFile(path.join(filesRoot, path1), pdf);
  // path2 puuttuu levyltä tarkoituksella; lisäksi orpo tiedosto organisaation kansiossa.
  await mkdir(path.join(filesRoot, SRC_ORG, "_", "orpo"), { recursive: true });
  await writeFile(path.join(filesRoot, SRC_ORG, "_", "orpo", "x.pdf"), Buffer.from("orpo"));

  await src.pg.exec(`
    insert into er_organizations (id, name, business_id, settings) values
      ('${SRC_ORG}', 'Adepta Oy', '${BID}', '{"note":"x"}'), ('${DEMO_ORG}', 'Demo Isännöinti Oy', '0000001-9', '{}');
    insert into er_users (id, auth_sub, email) values
      ('${JUKKA}', 'dev|jukka', 'jukka.taskinen@adepta.fi'),
      ('${KIRJANPITAJA}', 'dev|adepta-kirjanpitaja-1', 'kirjanpitaja1@adepta.invalid'),
      ('${DEMO_USER}', 'dev|isannoitsija', 'iida@example.test');
    insert into er_org_members (organization_id, user_id, role) values
      ('${SRC_ORG}', '${JUKKA}', 'owner'), ('${SRC_ORG}', '${KIRJANPITAJA}', 'accountant'), ('${DEMO_ORG}', '${DEMO_USER}', 'owner');
    insert into er_housing_companies (id, organization_id, name, business_id, manager_user_id) values
      ('${COMPANY}', '${SRC_ORG}', 'As Oy Keksitty', '1234567-1', '${JUKKA}'),
      ('${DEMO_COMPANY}', '${DEMO_ORG}', 'As Oy Demo', '7654321-2', '${DEMO_USER}');
    insert into er_share_groups (id, organization_id, company_id, unit_label) values ('${GROUP}', '${SRC_ORG}', '${COMPANY}', 'A 1');
    insert into er_share_groups (organization_id, company_id, unit_label) values ('${DEMO_ORG}', '${DEMO_COMPANY}', 'B 1');
    insert into er_share_ranges (id, organization_id, company_id, share_group_id, first_share, last_share) values
      ('${RANGE}', '${SRC_ORG}', '${COMPANY}', '${GROUP}', 1, 150);
    insert into er_test_range_notes (share_range_id, note) values ('${RANGE}', 'huomio');
    insert into er_parties (id, organization_id, first_names, last_name, email, user_id) values
      ('${PARTY}', '${SRC_ORG}', 'Keksi', 'Osakas', 'keksi@example.test', '${JUKKA}');
    insert into er_parties (organization_id, company_name) values ('${DEMO_ORG}', 'Demo Oy');
    insert into er_party_identifiers (party_id, organization_id, birth_date, hetu_hmac, hetu_encrypted, hetu_suffix, source) values
      ('${PARTY}', '${SRC_ORG}', '1970-01-01', 'hmac', 'salattu', '123A', 'manual');
    insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator) values
      ('${SRC_ORG}', '${GROUP}', '${PARTY}', 1, 3);
    insert into er_documents (id, organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by) values
      ('${DOC1}', '${SRC_ORG}', '${COMPANY}', 'articles', 'Yhtiöjärjestys', 'yhtiojarjestys.pdf', '${path1}', 'application/pdf', ${pdf.length}, '${sha(pdf)}', '${JUKKA}'),
      ('${DOC2}', '${SRC_ORG}', '${COMPANY}', 'floor_plan', 'Pohja', 'pohja.pdf', '${path2}', 'application/pdf', ${pic.length}, '${sha(pic)}', '${KIRJANPITAJA}');
    insert into er_contract_batches (id, organization_id, template_key, template_version, title, previous_batch_id, created_by) values
      ('${BATCH2}', '${SRC_ORG}', 'lumityo', 1, 'Talvi 2027', null, '${KIRJANPITAJA}');
    insert into er_contract_batches (id, organization_id, template_key, template_version, title, previous_batch_id) values
      ('${BATCH1}', '${SRC_ORG}', 'lumityo', 1, 'Talvi 2028', '${BATCH2}');
    insert into er_audit_log (organization_id, user_id, action, entity) values ('${SRC_ORG}', '${JUKKA}', 'create', 'er_documents');
    insert into er_outbound_messages (organization_id, channel, recipient, subject, body) values ('${SRC_ORG}', 'email', 'keksi@example.test', 'Aihe', 'Runko');
  `);

  await tgt.pg.exec(`
    insert into er_organizations (id, name, business_id) values ('${TGT_ORG}', 'Adepta Oy', '${BID}');
    insert into er_users (id, auth_sub, email) values ('${OWNER}', 'auth0|owner', 'info+erappu@example.test');
    insert into er_org_members (organization_id, user_id, role) values ('${TGT_ORG}', '${OWNER}', 'owner');
    insert into er_invitations (organization_id, email, kind, role, token_hash, expires_at, accepted_by)
      values ('${TGT_ORG}', 'info+erappu@example.test', 'staff', 'owner', 'tiiviste', now() + interval '14 days', '${OWNER}');
  `);
});

afterAll(async () => {
  await Promise.all([src?.pg.close(), tgt?.pg.close()]);
  if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
});

const plan = () => buildMigrationPlan(src.sql, tgt.sql, { businessId: BID, sourceUserEmail: "jukka.taskinen@adepta.fi" });

describe("organisaation siirto tuotantoon", () => {
  it("suunnitelma: vain Adepta Oy, org-id ja käyttäjät kartoitettu, henkilötunnukset ja jonot pois", async () => {
    const p = await plan();
    expect(p.sourceOrgId).toBe(SRC_ORG);
    expect(p.targetOrgId).toBe(TGT_ORG);
    const rows = (t: string) => p.tables.find((x) => x.name === t)?.rows.length ?? -1;
    expect(rows("er_housing_companies")).toBe(1);
    expect(rows("er_share_groups")).toBe(1);
    expect(rows("er_parties")).toBe(1);
    expect(rows("er_test_range_notes")).toBe(1);
    expect(p.tables.map((t) => t.name)).not.toContain("er_users");
    expect(p.tables.map((t) => t.name)).not.toContain("er_party_identifiers");
    expect(p.tables.map((t) => t.name)).not.toContain("er_outbound_messages");
    expect(p.excludedTables.find((e) => e.table === "er_party_identifiers")?.sourceRows).toBe(1);
    // FK-järjestys: yhtiö ennen osakeryhmää, osakeväli ennen muistiinpanoa.
    const order = p.tables.map((t) => t.name);
    expect(order.indexOf("er_housing_companies")).toBeLessThan(order.indexOf("er_share_groups"));
    expect(order.indexOf("er_share_ranges")).toBeLessThan(order.indexOf("er_test_range_notes"));
    expect(p.files.map((f) => f.targetPath.split("/")[0])).toEqual([TGT_ORG, TGT_ORG]);

    const summary = summarizePlan(p, null, null).join("\n");
    expect(summary).toContain("As Oy Keksitty");
    expect(summary).not.toContain("As Oy Demo");
    expect(summary).not.toMatch(/Keksi Osakas|keksi@|@example\.test|@adepta/);
  });

  it("tiedostotarkistus löytää puuttuvan ja orvon tiedoston", async () => {
    const p = await plan();
    const f = await checkFiles(p, filesRoot);
    expect(f.total).toBe(2);
    expect(f.missing.map((x) => x.id)).toEqual([DOC2]);
    expect(f.sizeMismatch).toHaveLength(0);
    expect(f.hashMismatch).toHaveLength(0);
    expect(f.pathMismatch.map((x) => x.id)).toEqual([DOC2]); // yhtiön dokumentti polussa "_"
    expect(f.unreferenced.count).toBe(1);
  });

  it("kuivaharjoitus tarkistaa FK:t ja RLS:n ja peruu kaiken", async () => {
    const p = await plan();
    const r = await applyMigrationPlan(tgt.sql, p, { commit: false, replaceExisting: false });
    expect(r.committed).toBe(false);
    expect(r.triggerMode).toBe("replica");
    expect(r.errors).toEqual([]);
    expect(r.insertedRows.every((x) => x.actual === x.expected)).toBe(true);
    expect(r.rls.find((x) => x.table === "er_housing_companies")).toMatchObject({ expected: 1, visible: 1 });
    expect(await count(tgt.sql, "er_housing_companies")).toBe(0);
    expect(await count(tgt.sql, "er_documents")).toBe(0);
    expect(await count(tgt.sql, "er_users")).toBe(1);
  });

  it("--aja kirjoittaa: org-id, käyttäjäviittaukset, storage_path ja generoitu sarake", async () => {
    const p = await plan();
    const r = await applyMigrationPlan(tgt.sql, p, { commit: true, replaceExisting: false });
    expect(r.committed).toBe(true);

    const company = (await tgt.sql.query<{ organization_id: string; manager_user_id: string }>("select organization_id::text, manager_user_id::text from er_housing_companies"))[0];
    expect(company).toEqual({ organization_id: TGT_ORG, manager_user_id: OWNER });
    const docs = await tgt.sql.query<{ id: string; storage_path: string; uploaded_by: string | null }>("select id::text, storage_path, uploaded_by::text from er_documents order by id");
    expect(docs).toEqual([
      { id: DOC1, storage_path: expect.stringMatching(new RegExp(`^${TGT_ORG}/${COMPANY}/`)), uploaded_by: OWNER },
      { id: DOC2, storage_path: expect.stringMatching(new RegExp(`^${TGT_ORG}/_/`)), uploaded_by: null },
    ]);
    const party = (await tgt.sql.query<{ user_id: string | null; display_name: string }>("select user_id::text, display_name from er_parties"))[0];
    expect(party).toEqual({ user_id: null, display_name: "Keksi Osakas" });
    const own = (await tgt.sql.query<{ share_numerator: number; share_denominator: number }>("select share_numerator, share_denominator from er_ownerships"))[0];
    expect(own).toEqual({ share_numerator: 1, share_denominator: 3 });
    expect((await tgt.sql.query<{ share_count: number }>("select share_count from er_share_groups"))[0].share_count).toBe(150); // lähteen laskettu arvo säilyy
    expect(await count(tgt.sql, "er_party_identifiers")).toBe(0);
    expect(await count(tgt.sql, "er_audit_log where organization_id = $1", [TGT_ORG])).toBe(0);
    expect(await count(tgt.sql, "er_outbound_messages")).toBe(0);
    expect(await count(tgt.sql, "er_org_members")).toBe(1);
    expect(await count(tgt.sql, "er_users")).toBe(1);
    expect(await count(tgt.sql, "er_organizations where id::text <> $1", [TGT_ORG])).toBe(0);
    expect(await count(tgt.sql, "er_test_range_notes")).toBe(1);
    expect(await count(tgt.sql, "er_contract_batches where created_by is null")).toBe(2);
    expect(await count(tgt.sql, "er_contract_batches where previous_batch_id is not null")).toBe(1);
  });

  it("uudelleenajo kieltäytyy, ja --korvaa-org-data korvaa datan ilman kahdentumista (myös ilman replica-tilaa)", async () => {
    const p = await plan();
    await expect(applyMigrationPlan(tgt.sql, p, { commit: true, replaceExisting: false })).rejects.toBeInstanceOf(ExistingDataError);

    const r = await applyMigrationPlan(tgt.sql, p, { commit: true, replaceExisting: true, triggerMode: "disable" });
    expect(r.committed).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.deletedRows.find((d) => d.table === "er_housing_companies")?.rows).toBe(1);
    expect(r.deletedRows.find((d) => d.table === "er_test_range_notes")?.rows).toBe(1);
    expect(await count(tgt.sql, "er_housing_companies")).toBe(1);
    expect(await count(tgt.sql, "er_test_range_notes")).toBe(1);
    expect(await count(tgt.sql, "er_contract_batches")).toBe(2);
    // Organisaatio, käyttäjä, jäsenyys ja kutsu säilyvät.
    expect(await count(tgt.sql, "er_invitations")).toBe(1);
    expect(await count(tgt.sql, "er_org_members where role = 'owner'")).toBe(1);
    // Triggerit palautettiin.
    expect(await count(tgt.sql, "pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'er_share_ranges' and t.tgenabled = 'D'")).toBe(0);
  });

  it("virheellinen FK perii koko siirron", async () => {
    const p = await plan();
    const docs = p.tables.find((t) => t.name === "er_documents")!;
    const idx = docs.columns.findIndex((c) => c.name === "share_group_id");
    docs.rows[0][idx] = "00000000-0000-4000-8000-00000000abcd";
    await expect(applyMigrationPlan(tgt.sql, p, { commit: true, replaceExisting: true })).rejects.toThrow(/FK/);
    expect(await count(tgt.sql, "er_housing_companies")).toBe(1);
  });

  it("tiedostojen lataus: upsert kohdepolkuun", async () => {
    const p = await plan();
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await uploadFiles(p.files.filter((f) => f.id === DOC1), { filesRoot, supabaseUrl: "https://ref.supabase.co/", secretKey: "sb_secret_x", fetchImpl: fakeFetch });
    expect(res.uploaded).toBe(1);
    expect(calls[0].url).toMatch(new RegExp(`^https://ref\\.supabase\\.co/storage/v1/object/documents/${TGT_ORG}/${COMPANY}/`));
    expect(calls[0].headers["x-upsert"]).toBe("true");
    expect(calls[0].headers.apikey).toBe("sb_secret_x");
  });

  it("ympäristötiedostosta ohitetaan Vercelin paikkamerkit ja otetaan viimeinen kelvollinen arvo", () => {
    const env = productionEnv(
      ['SUPABASE_URL="[SENSITIVE]"', 'SUPABASE_SECRET_KEY="[SENSITIVE]"', 'POSTGRES_URL_NON_POOLING="[SENSITIVE]"', "POSTGRES_URL_NON_POOLING=postgres://u:p@h:5432/db", 'SUPABASE_URL="https://ref.supabase.co"', "SUPABASE_SECRET_KEY=sb_secret_abc"].join("\n"),
    );
    expect(env.SUPABASE_URL).toBe("https://ref.supabase.co");
    expect(env.SUPABASE_SECRET_KEY).toBe("sb_secret_abc");
    expect(env.POSTGRES_URL_NON_POOLING).toBe("postgres://u:p@h:5432/db");
    expect(productionEnv('SUPABASE_URL="[SENSITIVE]"').SUPABASE_URL).toBeUndefined();
  });
});
