import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createPgliteDatabase } from "../../src/lib/db/pglite.ts";
import type { Sql } from "../../src/lib/db/types.ts";

/**
 * Huoneistokohtaiset pohjapiirustukset huoneistojen liitteiksi.
 *
 *   npx tsx scripts/registry/apply-floor-plans.mts data/private/floor-plans-YYYY-MM-DD.json
 *
 * Määrittely: { organizationBusinessId, company, source, visibility, units: { "1": "polku/huoneisto-1.png", ... } }
 * - Tallentaa kuvan dokumentiksi (luokka Pohjapiirustus) osakeryhmälle, joka
 *   löytyy huoneistotunnuksella. Sama tiedosto (SHA-256) ei tallennu kahdesti.
 * - Ei aja migraatioita, jotta keskeneräinen migraatio ei päädy kantaan.
 *   Kehityspalvelin ei saa olla käynnissä.
 */

interface Spec {
  organizationBusinessId: string;
  company: string;
  source: string;
  visibility: "internal" | "board" | "owners" | "residents";
  units: Record<string, string>;
}

const specPath = process.argv[2];
if (!specPath) throw new Error("Anna määrittelytiedosto: npx tsx scripts/registry/apply-floor-plans.mts data/private/floor-plans.json");
const spec = JSON.parse((await readFile(specPath, "utf8")).replace(/^﻿/, "")) as Spec;
const FILES = path.join(process.cwd(), ".data", "files");
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };

const db = await createPgliteDatabase(path.join(process.cwd(), ".data", "pglite"));
const lines: string[] = [];

await db.asService(async (tx: Sql) => {
  const [org] = await tx.query<{ id: string }>("select id from er_organizations where business_id = $1", [spec.organizationBusinessId]);
  if (!org) throw new Error("Organisaatiota ei löytynyt.");
  const [actor] = await tx.query<{ id: string }>(
    "select u.id from er_org_members m join er_users u on u.id = m.user_id where m.organization_id = $1 and m.role = 'owner' order by u.created_at limit 1",
    [org.id],
  );
  const [company] = await tx.query<{ id: string }>("select id from er_housing_companies where organization_id = $1 and lower(name) = lower($2)", [org.id, spec.company]);
  if (!company) throw new Error(`Yhtiötä ${spec.company} ei löytynyt.`);
  const groups = await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1 and removed_on is null", [company.id]);
  const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();

  for (const [label, file] of Object.entries(spec.units)) {
    const group = groups.find((g) => norm(g.unit_label) === norm(label));
    if (!group) {
      lines.push(`- Huoneisto ${label}: osakeryhmää ei löytynyt, ohitettiin.`);
      continue;
    }
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`${file}: tiedostotyyppi ei kelpaa`);
    const info = await stat(file);
    const bytes = await readFile(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const [existing] = await tx.query<{ id: string }>("select id from er_documents where company_id = $1 and sha256 = $2", [company.id, sha]);
    if (existing) {
      lines.push(`- Huoneisto ${group.unit_label}: sama kuva oli jo tallennettuna.`);
      continue;
    }
    const title = `Pohjapiirustus, huoneisto ${group.unit_label}`;
    const fileName = `pohjapiirustus-huoneisto-${group.unit_label.replace(/\s+/g, "")}${path.extname(file).toLowerCase()}`;
    const storagePath = `${org.id}/${company.id}/${randomUUID()}/${fileName.normalize("NFKD").replace(/[^\w.-]+/g, "")}`;
    await mkdir(path.dirname(path.join(FILES, storagePath)), { recursive: true });
    await copyFile(file, path.join(FILES, storagePath));
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, uploaded_by)
       values ($1,$2,$3,'floor_plan',$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [org.id, company.id, group.id, title, fileName, storagePath, mime, info.size, sha, spec.visibility, actor?.id ?? null],
    );
    await tx.query(
      "insert into er_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1,$2,'create','document',$3,$4)",
      [org.id, actor?.id ?? null, doc.id, JSON.stringify({ category: "floor_plan", source: spec.source })],
    );
    lines.push(`- Huoneisto ${group.unit_label}: ${title} tallennettu.`);
  }

  const others = await tx.query<{ unit_label: string | null; title: string; visibility: string }>(
    `select g.unit_label, d.title, d.visibility from er_documents d left join er_share_groups g on g.id = d.share_group_id
      where d.company_id = $1 and d.category = 'floor_plan' order by g.unit_label nulls first, d.title`,
    [company.id],
  );
  lines.push("", "Yhtiön pohjapiirustukset nyt:", ...others.map((o) => `- ${o.unit_label ?? "yhtiö"}: ${o.title} (${o.visibility})`));
});

await db.close();
console.log(`# Pohjapiirustukset: ${spec.company}\n\n${spec.source}.\n${lines.join("\n")}`);
