import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { migrationDatabaseUrl, stripSslMode, supabaseHeaders, supabaseSecretKey } from "../../src/lib/config/deploy-env.ts";

/**
 * Migraatiot Supabaseen ja yksityinen tiedostobucket.
 *
 *   npx tsx scripts/db/migrate-remote.mts            ajaa, jos kanta on asetettu
 *   npx tsx scripts/db/migrate-remote.mts --vercel   Vercelin buildissa: vain tuotantojulkaisussa
 *
 * - Sama `er_schema_migrations`-kirjanpito kuin paikallisessa PGlitessä.
 *   `supabase/local`-jäljitelmää ei ajeta: Supabasessa auth-skeema ja roolit ovat valmiina.
 * - Jokainen migraatio omassa transaktiossaan; virhe pysäyttää ajon ja buildin.
 * - Advisory lock estää kahden samanaikaisen julkaisun päällekkäiset ajot.
 */

const onVercel = process.argv.includes("--vercel");
if (onVercel && process.env.VERCEL_ENV !== "production") {
  console.log(`Migraatiot ohitettu (VERCEL_ENV=${process.env.VERCEL_ENV ?? "–"}). Ne ajetaan vain tuotantojulkaisussa.`);
  process.exit(0);
}

const url = migrationDatabaseUrl();
if (!url) {
  if (onVercel) throw new Error("Tuotantojulkaisusta puuttuu tietokantayhteys (POSTGRES_URL_NON_POOLING tai DATABASE_URL).");
  console.log("Tietokantayhteyttä ei ole asetettu, migraatiot ohitettu.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: stripSslMode(url), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('erappu_migrations'))");
  await client.query(`create table if not exists er_schema_migrations (name text primary key, applied_at timestamptz not null default now());
    grant select on er_schema_migrations to service_role;`);
  const applied = new Set((await client.query<{ name: string }>("select name from er_schema_migrations")).rows.map((r) => r.name));
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into er_schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      ran.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migraatio ${file} epäonnistui: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(ran.length ? `Migraatiot ajettu: ${ran.join(", ")}` : "Kanta on ajan tasalla.");
} finally {
  await client.query("select pg_advisory_unlock(hashtext('erappu_migrations'))").catch(() => undefined);
  await client.end();
}

// Yksityinen bucket dokumenteille (idempotentti).
const key = supabaseSecretKey();
if (process.env.SUPABASE_URL && key) {
  const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...supabaseHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ id: "documents", name: "documents", public: false, file_size_limit: 20 * 1024 * 1024 }),
  });
  if (res.ok) console.log("Tiedostobucket documents luotu.");
  else {
    const text = await res.text();
    if (/already exists|Duplicate/i.test(text)) console.log("Tiedostobucket documents on jo olemassa.");
    else throw new Error(`Bucketin luonti epäonnistui (${res.status}): ${text.slice(0, 200)}`);
  }
}
