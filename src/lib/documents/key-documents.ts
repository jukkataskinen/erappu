import type { Sql } from "@/lib/db";

/**
 * Taloyhtiön perusdokumentit, joita tarvitaan jatkuvasti isännöitsijäntodistuksen
 * ja asuntokaupan liitteinä: yhtiöjärjestys, viimeisin tilinpäätös, talousarvio
 * ja energiatodistus. Kustakin luokasta uusin (vuosi, sitten tallennusaika).
 */
export const KEY_DOCUMENT_CATEGORIES = [
  { category: "articles", label: "Yhtiöjärjestys" },
  { category: "financial_statement", label: "Tilinpäätös" },
  { category: "budget", label: "Talousarvio" },
  { category: "energy_certificate", label: "Energiatodistus" },
  { category: "maintenance_needs_report", label: "Kunnossapitotarveselvitys" },
  { category: "maintenance_plan", label: "Kunnossapitosuunnitelma" },
] as const;

export type KeyCategory = (typeof KEY_DOCUMENT_CATEGORIES)[number]["category"];

export interface KeyDocument {
  id: string;
  company_id: string;
  category: KeyCategory;
  title: string;
  year: number | null;
  created_at: Date | string;
}

export async function latestKeyDocuments(tx: Sql, companyIds: string[]): Promise<Map<string, Partial<Record<KeyCategory, KeyDocument>>>> {
  const result = new Map<string, Partial<Record<KeyCategory, KeyDocument>>>();
  if (companyIds.length === 0) return result;
  const rows = await tx.query<KeyDocument>(
    `select distinct on (company_id, category) id, company_id, category, title, year, created_at
       from er_documents
      where company_id = any($1::uuid[]) and share_group_id is null and subject_table is null
        and category = any($2::text[])
      order by company_id, category, year desc nulls last, created_at desc`,
    [companyIds, KEY_DOCUMENT_CATEGORIES.map((c) => c.category)],
  );
  for (const r of rows) {
    const entry = result.get(r.company_id) ?? {};
    entry[r.category] = r;
    result.set(r.company_id, entry);
  }
  return result;
}
