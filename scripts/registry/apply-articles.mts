import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { openLocalDb } from "../lib/local-db.mts";
import type { Sql } from "../../src/lib/db/types.ts";
import { checkCoverage, countShares, formatRanges, parseShareRanges, type ShareRange } from "../../src/lib/registry/share-ranges.ts";

/**
 * Yhtiöjärjestysten osakevälit rekisteriin ja PDF yhtiön dokumentteihin.
 *
 *   npx tsx scripts/registry/apply-articles.mts data/private/articles-YYYY-MM-DD.json
 *
 * - Vertaa jokaisen huoneiston osakevälit yhtiöjärjestykseen ja korjaa erot.
 *   Kohdistus huoneiston tunnuksella (matchBy "label") tai, kun tunnukset
 *   eroavat, nykyisen osakevälin mukaan (matchBy "range").
 * - Päivittää yhtiön osakemäärän yhtiöjärjestyksen mukaiseksi.
 * - Tallentaa yhtiöjärjestyksen PDF:n dokumentiksi (luokka Yhtiöjärjestys,
 *   näkyvyys osakkaat). Sama tiedosto (SHA-256) ei tallennu kahdesti.
 * - HTJ:stä tulleita osakeryhmiä ei muuteta.
 * - Kaikki muutokset tapahtumalokiin. Kehityspalvelin ei saa olla käynnissä.
 */

interface Spec {
  organizationBusinessId: string;
  source: string;
  companies: { company: string; file: string; totalShares: number; matchBy: "label" | "range"; note?: string; units: Record<string, string> }[];
}

const specPath = process.argv[2];
if (!specPath) throw new Error("Anna määrittelytiedosto: npx tsx scripts/registry/apply-articles.mts data/private/articles.json");
const spec = JSON.parse((await readFile(specPath, "utf8")).replace(/^﻿/, "")) as Spec;
const FILES = path.join(process.cwd(), ".data", "files");
const same = (a: ShareRange[], b: ShareRange[]) =>
  a.length === b.length && [...a].sort((x, y) => x.first - y.first).every((r, i) => {
    const s = [...b].sort((x, y) => x.first - y.first)[i];
    return r.first === s.first && r.last === s.last;
  });

const db = await openLocalDb();
const lines: string[] = [];

await db.asService(async (tx: Sql) => {
  const [org] = await tx.query<{ id: string }>("select id from er_organizations where business_id = $1", [spec.organizationBusinessId]);
  if (!org) throw new Error("Organisaatiota ei löytynyt. Aja ensin Access-tuonti.");
  const [actor] = await tx.query<{ id: string }>(
    "select u.id from er_org_members m join er_users u on u.id = m.user_id where m.organization_id = $1 and m.role = 'owner' order by u.created_at limit 1",
    [org.id],
  );

  for (const c of spec.companies) {
    const [company] = await tx.query<{ id: string; total_shares: number | null }>(
      "select id, total_shares from er_housing_companies where organization_id = $1 and lower(name) = lower($2)",
      [org.id, c.company],
    );
    if (!company) {
      lines.push(`\n## ${c.company}\n- Yhtiötä ei löytynyt rekisteristä, ohitettiin.`);
      continue;
    }
    const out: string[] = [];
    const groups = await tx.query<{ id: string; unit_label: string; source: string; ranges: ShareRange[] }>(
      `select g.id, g.unit_label, g.source,
              coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share)) from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
         from er_share_groups g where g.company_id = $1 and g.removed_on is null`,
      [company.id],
    );

    // Kohdistus: yhtiöjärjestyksen huoneisto → rekisterin osakeryhmä
    const plan: { groupId: string; label: string; yjLabel: string; from: ShareRange[]; to: ShareRange[] }[] = [];
    let matched = 0;
    for (const [yjLabel, text] of Object.entries(c.units)) {
      const parsed = parseShareRanges(text);
      if (parsed.errors.length) {
        out.push(`- Huoneisto ${yjLabel}: yhtiöjärjestyksen väli "${text}" ei kelpaa (${parsed.errors[0]}).`);
        continue;
      }
      const group =
        c.matchBy === "label"
          ? groups.find((g) => g.unit_label.replace(/\s/g, "").toLowerCase() === yjLabel.replace(/\s/g, "").toLowerCase())
          : groups.find((g) => same(g.ranges, parsed.ranges));
      if (!group) {
        out.push(`- Huoneisto ${yjLabel} (${text}): vastaavaa osakeryhmää ei löytynyt rekisteristä. Lisää tai korjaa käsin.`);
        continue;
      }
      matched++;
      if (same(group.ranges, parsed.ranges)) continue;
      if (group.source === "htj") {
        out.push(`- Huoneisto ${group.unit_label}: tiedot tulevat HTJ:stä, ei muutettu (rekisterissä ${formatRanges(group.ranges) || "ei välejä"}, yhtiöjärjestyksessä ${text}).`);
        continue;
      }
      plan.push({ groupId: group.id, label: group.unit_label, yjLabel, from: group.ranges, to: parsed.ranges });
    }

    await tx.query("savepoint company_articles");
    try {
      // Ensin kaikki muuttuvat välit pois, sitten uudet: muuten korjaus voisi
      // törmätä toisen huoneiston vielä korjaamattomaan väliin.
      for (const p of plan) await tx.query("delete from er_share_ranges where share_group_id = $1", [p.groupId]);
      for (const p of plan) {
        for (const r of p.to) {
          await tx.query(
            "insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)",
            [org.id, company.id, p.groupId, r.first, r.last],
          );
        }
        await tx.query(
          "insert into er_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1,$2,'update','share_ranges',$3,$4)",
          [org.id, actor?.id ?? null, p.groupId, JSON.stringify({ source: "articles_of_association", from: p.from, to: p.to })],
        );
        out.push(
          `- Huoneisto ${p.label}${c.matchBy === "range" ? ` (yhtiöjärjestyksessä ${p.yjLabel})` : ""}: ${p.from.length ? formatRanges(p.from) : "osakenumerot puuttuivat"} → ${formatRanges(p.to)} (${countShares(p.to)} osaketta).`,
        );
      }
      await tx.query("release savepoint company_articles");
    } catch (err) {
      await tx.query("rollback to savepoint company_articles");
      out.push(`- VIRHE: osakevälien päivitys peruttiin (${err instanceof Error ? err.message : "tuntematon virhe"}).`);
    }

    if (company.total_shares !== c.totalShares) {
      await tx.query("update er_housing_companies set total_shares = $2 where id = $1", [company.id, c.totalShares]);
      out.push(`- Yhtiön osakemäärä ${company.total_shares ?? "puuttui"} → ${c.totalShares}.`);
    }

    const after = await tx.query<{ unit_label: string; ranges: ShareRange[] }>(
      `select g.unit_label, coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share)) from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
         from er_share_groups g where g.company_id = $1 and g.removed_on is null`,
      [company.id],
    );
    const issues = checkCoverage(after.map((a) => ({ unitLabel: a.unit_label, ranges: a.ranges })), c.totalShares);
    const extraGroups = groups.length - matched;

    // Yhtiöjärjestyksen PDF dokumentiksi
    const info = await stat(c.file).catch(() => null);
    if (!info) {
      out.push("- Yhtiöjärjestyksen tiedostoa ei löytynyt, dokumenttia ei tallennettu.");
    } else {
      const bytes = await readFile(c.file);
      if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error(`${c.file} ei ole PDF`);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const [existing] = await tx.query<{ id: string }>("select id from er_documents where company_id = $1 and sha256 = $2", [company.id, sha]);
      if (existing) {
        await tx.query("update er_documents set category = 'articles', title = 'Yhtiöjärjestys', visibility = 'owners' where id = $1", [existing.id]);
        out.push("- Yhtiöjärjestys oli jo tallennettuna, merkitty yhtiöjärjestykseksi ja osakkaille näkyväksi.");
      } else {
        const fileName = path.basename(c.file);
        const key = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "").replace(/\.{2,}/g, ".") || "yhtiojarjestys.pdf";
        const storagePath = `${org.id}/${company.id}/${randomUUID()}/${key}`;
        await mkdir(path.dirname(path.join(FILES, storagePath)), { recursive: true });
        await copyFile(c.file, path.join(FILES, storagePath));
        const [doc] = await tx.query<{ id: string }>(
          `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, uploaded_by)
           values ($1,$2,'articles','Yhtiöjärjestys',$3,$4,'application/pdf',$5,$6,'owners',$7) returning id`,
          [org.id, company.id, fileName, storagePath, info.size, sha, actor?.id ?? null],
        );
        await tx.query(
          "insert into er_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1,$2,'create','document',$3,$4)",
          [org.id, actor?.id ?? null, doc.id, JSON.stringify({ category: "articles", source: "articles_of_association" })],
        );
        out.push("- Yhtiöjärjestys tallennettu dokumentteihin (näkyy osakkaille).");
      }
    }

    lines.push(`\n## ${c.company}`);
    if (c.note) lines.push(`_${c.note}_`);
    lines.push(...(out.length ? out : ["- Osakevälit vastasivat jo yhtiöjärjestystä."]));
    if (extraGroups > 0) lines.push(`- Rekisterissä on ${extraGroups} osakeryhmää, joita yhtiöjärjestyksessä ei ole (esim. autokatokset). Tarkista, ovatko ne osakeryhmiä vai yhtiön hallinnassa.`);
    lines.push(issues.length ? `- Tarkistus jälkeen: ${issues.map((i) => i.message).join("; ")}.` : "- Tarkistus: osakevälit yhtenäiset ja täsmäävät yhtiön osakemäärään.");
  }
});

await db.close();
console.log(`# Yhtiöjärjestysten osakevälit\n\n${spec.source}.${lines.join("\n")}`);
