import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { latestKeyDocuments } from "@/lib/documents/key-documents";

let db: Database;
let f: Fixture;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    const doc = (companyId: string, org: string, category: string, title: string, year: number | null, sha: string) =>
      tx.query(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, year)
         values ($1,$2,$3,$4,'x.pdf',$5,'application/pdf',1,$6,$7)`,
        [org, companyId, category, title, `${sha}/x.pdf`, sha, year],
      );
    await doc(f.companyA, f.orgA, "financial_statement", "Tilinpäätös 2024", 2024, "a1");
    await doc(f.companyA, f.orgA, "financial_statement", "Tilinpäätös 2025", 2025, "a2");
    await doc(f.companyA, f.orgA, "articles", "Yhtiöjärjestys", null, "a3");
    await doc(f.companyB, f.orgB, "articles", "B:n yhtiöjärjestys", null, "b1");
  });
});
afterAll(async () => db.close());

describe("perusdokumentit", () => {
  it("palauttaa luokittain uusimman ja rajautuu organisaatioon", async () => {
    const map = await db.asUser(f.managerA.sub, (tx) => latestKeyDocuments(tx, [f.companyA, f.companyB]));
    expect(map.get(f.companyA)?.financial_statement?.title).toBe("Tilinpäätös 2025");
    expect(map.get(f.companyA)?.articles?.title).toBe("Yhtiöjärjestys");
    expect(map.get(f.companyA)?.energy_certificate).toBeUndefined();
    expect(map.has(f.companyB)).toBe(false);
  });
});
