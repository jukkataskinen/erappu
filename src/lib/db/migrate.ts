import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types";

const ROOT = process.cwd();

/**
 * Ajaa paikallisen Supabase-jäljitelmän ja kaikki migraatiot järjestyksessä.
 * Käytetään vain PGlitessä; Supabaseen migraatiot ajetaan Supabase CLI:llä.
 */
export async function migrateLocal(db: Database, root = ROOT): Promise<string[]> {
  await db.exec(await readFile(path.join(root, "supabase/local/0000_supabase_shim.sql"), "utf8"));
  await db.exec(`create table if not exists er_schema_migrations (
    name text primary key, applied_at timestamptz not null default now());
    grant select on er_schema_migrations to service_role;`);

  const dir = path.join(root, "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await db.asService((tx) => tx.query<{ name: string }>("select name from er_schema_migrations"))).map(
      (r) => r.name,
    ),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await db.exec(`begin;\n${sql}\n;insert into er_schema_migrations (name) values ('${file.replace(/'/g, "")}');\ncommit;`);
    ran.push(file);
  }
  return ran;
}
