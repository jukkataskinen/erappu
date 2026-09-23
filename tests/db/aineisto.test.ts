import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { buildCompanyArchive } from "@/lib/export/company-archive";

/**
 * Yhtiön aineiston luovutus zip-tiedostona (palvelusopimus 10.3). Tärkeintä on,
 * että mukaan tulee vain tämän yhtiön aineisto ja että henkilötunnukset jäävät
 * pois.
 */
let db: Database;
let f: Fixture;
let assistantA: { id: string; sub: string };

/** Lukee arkiston nimet ja sisällöt paikallisista otsakkeista. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 <= zip.length && zip.readUInt32LE(i) === 0x04034b50) {
    const method = zip.readUInt16LE(i + 8);
    const compressed = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extraLen = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    const body = zip.subarray(start, start + compressed);
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    i = start + compressed;
  }
  return out;
}

const doc = (org: string, company: string, group: string | null, title: string, file: string, path: string) =>
  `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility)
   values ('${org}','${company}',${group ? `'${group}'` : "null"},'articles','${title}','${file}','${path}','application/pdf',9,'x','owners')`;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  assistantA = await createUser(db);
  await db.asService(async (tx) => {
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'assistant')", [f.orgA, assistantA.id]);
    const g = await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label, area_m2) values ($1,$2,'A 1',60) returning id", [f.orgA, f.companyA]);
    const p = await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name) values ($1,'Olli','Osakas') returning id", [f.orgA]);
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, starts_on, source) values ($1,$2,$3,'2020-01-01','manual')", [f.orgA, g.id, p.id]);
    await tx.query("insert into er_party_identifiers (party_id, organization_id, hetu_encrypted, source) values ($1,$2,'salattu-hetu','manual')", [p.id, f.orgA]);
    await tx.query(doc(f.orgA, f.companyA, g.id, "Yhtiöjärjestys", "yhtiöjärjestys.pdf", "a/1/yj.pdf"));
    await tx.query(doc(f.orgB, f.companyB, null, "Toisen yhtiön asiakirja", "salainen.pdf", "b/1/salainen.pdf"));
  });
});
afterAll(async () => db.close());

describe("yhtiön aineiston luovutus", () => {
  it("kokoaa rekisterin ja asiakirjat eikä ota mukaan toista yhtiötä", async () => {
    const result = await db.asUser(assistantA.sub, (tx) =>
      buildCompanyArchive(tx, f.companyA, assistantA.id, { read: async (path) => Buffer.from(`sisalto:${path}`) }),
    );
    expect(result).not.toBeNull();
    const files = readZip(result!.bytes);
    const names = [...files.keys()];

    expect(names).toContain("LUE-MINUT.txt");
    expect(names).toContain("rekisteri/yhtio.csv");
    expect(names).toContain("rekisteri/share_groups.csv");
    expect(names).toContain("rekisteri/henkilot.csv");
    expect(names).toContain("dokumentit/luettelo.csv");
    expect(names.some((n) => n.startsWith("dokumentit/articles/"))).toBe(true);
    expect(result!.documents).toBe(1);
    expect(result!.skipped).toEqual([]);

    const yhtiot = files.get("rekisteri/yhtio.csv")!.toString("utf8");
    expect(yhtiot).toContain("As Oy Testi A");
    expect(yhtiot).not.toContain("As Oy Testi B");
    expect(files.get("rekisteri/henkilot.csv")!.toString("utf8")).toContain("Osakas");
    // Henkilötunnus on omassa taulussaan, johon käyttäjän transaktio ei pääse.
    expect([...files.values()].some((b) => b.toString("utf8").includes("salattu-hetu"))).toBe(false);
    expect(names.some((n) => n.includes("salainen"))).toBe(false);
    expect(files.get("dokumentit/articles/A 1 - yhtiöjärjestys.pdf")!.toString("utf8")).toBe("sisalto:a/1/yj.pdf");
  });

  it("puuttuva tiedosto merkitään luetteloon eikä kaada koontia", async () => {
    const result = await db.asUser(assistantA.sub, (tx) =>
      buildCompanyArchive(tx, f.companyA, assistantA.id, {
        read: async () => {
          throw new Error("ei löydy");
        },
      }),
    );
    expect(result!.documents).toBe(0);
    expect(result!.skipped).toEqual(["yhtiöjärjestys.pdf"]);
    const luettelo = readZip(result!.bytes).get("dokumentit/luettelo.csv")!.toString("utf8");
    expect(luettelo).toContain("tiedostoa ei löytynyt");
  });

  it("toisen organisaation yhtiöstä ei saa aineistoa", async () => {
    expect(await db.asUser(assistantA.sub, (tx) => buildCompanyArchive(tx, f.companyB, assistantA.id, { read: async () => Buffer.from("x") }))).toBeNull();
  });
});
