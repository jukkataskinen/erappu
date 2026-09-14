import type { Sql } from "@/lib/db";
import { missingBasicDocuments, type MissingBasicDoc } from "./basics";

/**
 * Dokumenttipankin kyselyt. Ajetaan aina käyttäjän RLS-transaktiossa, joten
 * sama kysely palvelee henkilökuntaa ja portaalia: kanta rajaa näkyvät rivit.
 */

export interface DocumentRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  company_name: string | null;
  share_group_id: string | null;
  unit_label: string | null;
  category: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: string;
  visibility: string;
  year: number | null;
  subject_table: string | null;
  sealed: boolean;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface DocumentFilters {
  organizationId?: string;
  companyId?: string | null;
  category?: string | null;
  year?: number | null;
  q?: string | null;
  includeAttachments?: boolean;
  limit?: number;
}

export async function listDocuments(tx: Sql, f: DocumentFilters = {}): Promise<DocumentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, value: unknown) => {
    params.push(value);
    where.push(cond.replace("?", `$${params.length}`));
  };
  if (f.organizationId) add("d.organization_id = ?", f.organizationId);
  if (f.companyId) add("d.company_id = ?", f.companyId);
  if (f.category) add("d.category = ?", f.category);
  if (f.year) add("d.year = ?", f.year);
  // Hakusanan erikoismerkit (% ja _) eivät saa laajentaa hakua.
  if (f.q) add("d.title ilike ? escape '\\'", `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (!f.includeAttachments) where.push("d.subject_table is null");
  params.push(Math.min(f.limit ?? 500, 1000));

  return tx.query<DocumentRow>(
    `select d.id, d.organization_id, d.company_id, c.name as company_name, d.share_group_id, g.unit_label, d.category, d.title,
            d.file_name, d.mime_type, d.size_bytes, d.visibility, d.year, d.subject_table, d.sealed, d.created_at,
            coalesce(u.full_name, u.email) as uploaded_by_name
       from er_documents d
       left join er_housing_companies c on c.id = d.company_id
       left join er_share_groups g on g.id = d.share_group_id
       left join er_users u on u.id = d.uploaded_by
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by d.year desc nulls last, d.created_at desc
      limit $${params.length}`,
    params,
  );
}

export async function getDocument(tx: Sql, id: string): Promise<DocumentRow | null> {
  const [row] = await tx.query<DocumentRow>(
    `select d.id, d.organization_id, d.company_id, c.name as company_name, d.share_group_id, g.unit_label, d.category, d.title,
            d.file_name, d.mime_type, d.size_bytes, d.visibility, d.year, d.subject_table, d.sealed, d.created_at,
            coalesce(u.full_name, u.email) as uploaded_by_name
       from er_documents d
       left join er_housing_companies c on c.id = d.company_id
       left join er_share_groups g on g.id = d.share_group_id
       left join er_users u on u.id = d.uploaded_by
      where d.id = $1`,
    [id],
  );
  return row ?? null;
}

export async function documentYears(tx: Sql): Promise<number[]> {
  const rows = await tx.query<{ year: number }>("select distinct year from er_documents where year is not null order by year desc");
  return rows.map((r) => r.year);
}

export async function companyMissingBasics(tx: Sql, companyId: string, today = new Date()): Promise<MissingBasicDoc[]> {
  const docs = await tx.query<{ category: string; year: number | null }>(
    "select category, year from er_documents where company_id = $1 and category in ('articles', 'financial_statement', 'energy_certificate')",
    [companyId],
  );
  return missingBasicDocuments(docs, today);
}

/** Sallitut paluupolut latauslomakkeelta. Estää avoimen uudelleenohjauksen. */
export function safeBackPath(value: unknown, fallback = "/dokumentit"): string {
  if (typeof value !== "string") return fallback;
  if (!/^\/(dokumentit|taloyhtiot\/[0-9a-f-]{36}\/dokumentit)(\?[\w=&%-]*)?$/i.test(value)) return fallback;
  return value;
}

/**
 * Windows-selaimet ilmoittavat CSV:n usein Excel-tyypiksi tai jättävät tyypin
 * tyhjäksi. Tyyppi päätellään silloin päätteestä; sisältö tarkistetaan silti.
 */
export function normalizeDeclaredType(fileName: string, declared: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" && (declared === "" || declared === "application/vnd.ms-excel" || declared === "text/plain")) return "text/csv";
  if (declared) return declared;
  const byExt: Record<string, string> = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return byExt[ext] ?? "";
}
