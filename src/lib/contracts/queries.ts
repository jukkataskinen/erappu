import type { Sql } from "@/lib/db";
import type { IsoDate } from "@/lib/tasks/dates";
import type { ContractStatus } from "./deadlines";
import type { ContractCategory } from "./labels";

export interface ContractRow {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  counterparty: string;
  category: ContractCategory;
  description: string | null;
  starts_on: IsoDate | null;
  ends_on: IsoDate | null;
  notice_months: number | null;
  annual_cost_eur: string | null;
  document_id: string | null;
  document_title: string | null;
  reminder_on: IsoDate | null;
  reminded_at: string | null;
  status: ContractStatus;
}

const COLUMNS = `k.id, k.organization_id, k.company_id, c.name as company_name, k.counterparty, k.category, k.description,
  to_char(k.starts_on, 'YYYY-MM-DD') as starts_on, to_char(k.ends_on, 'YYYY-MM-DD') as ends_on, k.notice_months,
  k.annual_cost_eur::text as annual_cost_eur, k.document_id, d.title as document_title,
  to_char(k.reminder_on, 'YYYY-MM-DD') as reminder_on, k.reminded_at, k.status`;

const FROM = `from er_contracts k
  join er_housing_companies c on c.id = k.company_id
  left join er_documents d on d.id = k.document_id`;

export async function listContracts(
  tx: Sql,
  f: { organizationId: string; companyId?: string | null; category?: ContractCategory | null; status?: ContractStatus | null },
): Promise<ContractRow[]> {
  const where = ["k.organization_id = $1"];
  const params: unknown[] = [f.organizationId];
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`k.company_id = $${params.length}`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`k.category = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`k.status = $${params.length}`);
  }
  return tx.query<ContractRow>(
    `select ${COLUMNS} ${FROM} where ${where.join(" and ")}
      order by (k.status = 'ended'), k.ends_on nulls last, c.name, k.counterparty`,
    params,
  );
}

export async function getContract(tx: Sql, id: string): Promise<ContractRow | null> {
  const [row] = await tx.query<ContractRow>(`select ${COLUMNS} ${FROM} where k.id = $1`, [id]);
  return row ?? null;
}

/** Organisaation sopimus- ja vakuutusasiakirjat liitettäviksi. */
export async function listContractDocuments(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; title: string; company_name: string }>(
    `select d.id, d.title, c.name as company_name
       from er_documents d join er_housing_companies c on c.id = d.company_id
      where d.organization_id = $1 and d.category in ('contract', 'insurance')
      order by c.name, d.created_at desc limit 500`,
    [organizationId],
  );
}
