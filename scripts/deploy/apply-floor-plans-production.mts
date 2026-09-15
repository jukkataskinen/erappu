import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { migrationDatabaseUrl, stripSslMode, supabaseHeaders, supabaseSecretKey } from "../../src/lib/config/deploy-env.ts";
import { productionEnv } from "../../src/lib/deploy/migrate-org.ts";

/**
 * Huoneistokohtaiset pohjapiirustukset tuotantoon (Supabase Storage + er_documents).
 * Sama määrittely kuin paikallisella `scripts/registry/apply-floor-plans.mts`:llä.
 *
 *   npx tsx scripts/deploy/apply-floor-plans-production.mts data/private/floor-plans-<yhtiö>.json          kuivaharjoitus
 *   npx tsx scripts/deploy/apply-floor-plans-production.mts data/private/floor-plans-<yhtiö>.json --aja    kirjoittaa
 *
 * Muuttujat luetaan tiedostosta .env.production.local (--ymparisto <tiedosto>):
 * tietokantayhteys, SUPABASE_URL ja SUPABASE_SECRET_KEY. Paikkamerkit ohitetaan.
 * Sama tiedosto (SHA-256) samalle yhtiölle ei tallennu kahdesti.
 */

interface Spec {
  organizationBusinessId: string;
  company: string;
  source: string;
  visibility: "internal" | "board" | "owners" | "residents";
  units: Record<string, string>;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };
const arg = (nimi: string) => {
  const i = process.argv.indexOf(nimi);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function ajo() {
  const specPath = process.argv[2];
  if (!specPath || specPath.startsWith("--")) throw new Error("Anna määrittelytiedosto: npx tsx scripts/deploy/apply-floor-plans-production.mts data/private/floor-plans-<yhtiö>.json");
  const aja = process.argv.includes("--aja");
  const tiedosto = arg("--ymparisto") ?? ".env.production.local";
  if (!existsSync(tiedosto)) throw new Error(`${tiedosto} puuttuu.`);
  if (spawnSync("git", ["check-ignore", "-q", tiedosto]).status === 1) throw new Error(`${tiedosto} ei ole .gitignoressa.`);

  const env = productionEnv(readFileSync(tiedosto, "utf8"));
  const url = migrationDatabaseUrl(env);
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = supabaseSecretKey(env);
  if (!url || !supabaseUrl || !key) throw new Error(`${tiedosto}: tietokantayhteys, SUPABASE_URL tai SUPABASE_SECRET_KEY puuttuu.`);

  const spec = JSON.parse((await readFile(specPath, "utf8")).replace(/^﻿/, "")) as Spec;
  const client = new pg.Client({ connectionString: stripSslMode(url), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = async <T,>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as T[];
  const lines: string[] = [];

  try {
    const [org] = await q<{ id: string }>("select id from er_organizations where business_id = $1", [spec.organizationBusinessId]);
    if (!org) throw new Error("Organisaatiota ei löytynyt tuotannosta.");
    const [actor] = await q<{ id: string }>(
      "select u.id from er_org_members m join er_users u on u.id = m.user_id where m.organization_id = $1 and m.role = 'owner' order by u.created_at limit 1",
      [org.id],
    );
    const [company] = await q<{ id: string }>("select id from er_housing_companies where organization_id = $1 and lower(name) = lower($2)", [org.id, spec.company]);
    if (!company) throw new Error(`Yhtiötä ${spec.company} ei löytynyt tuotannosta.`);
    const groups = await q<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1 and removed_on is null", [company.id]);
    const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();

    console.log(`\nKohde: ${new URL(url).hostname}\nYhtiö: ${spec.company}\nTila: ${aja ? "KIRJOITETAAN" : "kuivaharjoitus"}\n`);

    for (const [label, file] of Object.entries(spec.units)) {
      const group = groups.find((g) => norm(g.unit_label) === norm(label));
      if (!group) {
        lines.push(`- Huoneisto ${label}: osakeryhmää ei löytynyt, ohitettiin.`);
        continue;
      }
      const ext = path.extname(file).toLowerCase();
      const mime = MIME[ext];
      if (!mime) throw new Error(`${file}: tiedostotyyppi ei kelpaa`);
      const bytes = await readFile(file);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const [existing] = await q<{ id: string }>("select id from er_documents where company_id = $1 and sha256 = $2", [company.id, sha]);
      if (existing) {
        lines.push(`- Huoneisto ${group.unit_label}: sama kuva on jo tallennettuna.`);
        continue;
      }
      const title = `Pohjapiirustus, huoneisto ${group.unit_label}`;
      const fileName = `pohjapiirustus-huoneisto-${group.unit_label.replace(/\s+/g, "")}${ext}`;
      const storagePath = `${org.id}/${company.id}/${randomUUID()}/${fileName.normalize("NFKD").replace(/[^\w.-]+/g, "")}`;
      if (!aja) {
        lines.push(`- Huoneisto ${group.unit_label}: tallennettaisiin (${Math.round(bytes.length / 1024)} kt).`);
        continue;
      }
      const res = await fetch(`${supabaseUrl}/storage/v1/object/documents/${encodeURI(storagePath)}`, {
        method: "POST",
        headers: { ...supabaseHeaders(key), "Content-Type": mime, "x-upsert": "true" },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new Error(`Huoneisto ${group.unit_label}: tiedoston lataus epäonnistui (${res.status}) ${(await res.text()).slice(0, 200)}`);
      const size = (await stat(file)).size;
      await q("begin");
      try {
        const [doc] = await q<{ id: string }>(
          `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, uploaded_by)
           values ($1,$2,$3,'floor_plan',$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [org.id, company.id, group.id, title, fileName, storagePath, mime, size, sha, spec.visibility, actor?.id ?? null],
        );
        await q(
          "insert into er_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1,$2,'create','document',$3,$4)",
          [org.id, actor?.id ?? null, doc.id, JSON.stringify({ category: "floor_plan", source: spec.source })],
        );
        await q("commit");
      } catch (err) {
        await q("rollback");
        throw err;
      }
      lines.push(`- Huoneisto ${group.unit_label}: ${title} tallennettu.`);
    }
    const unmatched = groups.filter((g) => !Object.keys(spec.units).some((l) => norm(l) === norm(g.unit_label)));
    if (unmatched.length) lines.push(`- Ilman kuvaa jäävät osakeryhmät: ${unmatched.map((g) => g.unit_label).sort((a, b) => a.localeCompare(b, "fi", { numeric: true })).join(", ")}`);
  } finally {
    await client.end().catch(() => undefined);
  }
  console.log(lines.join("\n"));
}

try {
  await ajo();
} catch (virhe) {
  console.error(`\n${virhe instanceof Error ? virhe.message : String(virhe)}\n`);
  process.exitCode = 1;
}
