import type { Sql } from "@/lib/db";
import type { TemplateValues } from "./types";

/** Massaluonnin lukukyselyt. Ajetaan käyttäjän RLS-transaktiossa. */

export type BatchStatus = "draft" | "generated" | "sent" | "completed" | "cancelled";
export type ItemStatus = "draft" | "generated" | "sent" | "signed" | "declined" | "cancelled" | "error";

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  draft: "Luonnos",
  generated: "Muodostettu",
  sent: "Lähetetty",
  completed: "Valmis",
  cancelled: "Peruttu",
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  draft: "Luonnos",
  generated: "Muodostettu",
  sent: "Odottaa allekirjoituksia",
  signed: "Allekirjoitettu",
  declined: "Hylätty",
  cancelled: "Peruttu",
  error: "Virhe",
};

type Tone = "neutral" | "info" | "ok" | "warn" | "alert";

export const BATCH_STATUS_TONE: Record<BatchStatus, Tone> = {
  draft: "neutral",
  generated: "info",
  sent: "warn",
  completed: "ok",
  cancelled: "neutral",
};

export const ITEM_STATUS_TONE: Record<ItemStatus, Tone> = {
  draft: "neutral",
  generated: "info",
  sent: "warn",
  signed: "ok",
  declined: "alert",
  cancelled: "neutral",
  error: "alert",
};

export interface BatchListRow {
  id: string;
  title: string;
  template_key: string;
  status: BatchStatus;
  provider_name: string | null;
  created_at: string;
  item_count: number;
  generated_count: number;
  sent_count: number;
  signed_count: number;
}

export async function listBatches(tx: Sql, organizationId: string): Promise<BatchListRow[]> {
  return tx.query<BatchListRow>(
    `select b.id, b.title, b.template_key, b.status, p.name as provider_name, b.created_at,
            count(i.id)::int as item_count,
            count(i.id) filter (where i.status in ('generated', 'sent', 'signed', 'declined', 'error'))::int as generated_count,
            count(i.id) filter (where i.status in ('sent', 'signed', 'declined'))::int as sent_count,
            count(i.id) filter (where i.status = 'signed')::int as signed_count
       from er_contract_batches b
       left join er_service_providers p on p.id = b.provider_id
       left join er_contract_batch_items i on i.batch_id = b.id
      where b.organization_id = $1
      group by b.id, p.name
      order by b.created_at desc`,
    [organizationId],
  );
}

export interface BatchRow {
  id: string;
  organization_id: string;
  template_key: string;
  template_version: number;
  title: string;
  provider_id: string | null;
  provider_name: string | null;
  provider_business_id: string | null;
  provider_email: string | null;
  shared_values: TemplateValues;
  status: BatchStatus;
  previous_batch_id: string | null;
  previous_title: string | null;
  created_at: string;
}

export async function getBatch(tx: Sql, id: string): Promise<BatchRow | null> {
  const [row] = await tx.query<BatchRow>(
    `select b.id, b.organization_id, b.template_key, b.template_version, b.title, b.provider_id, p.name as provider_name,
            p.business_id as provider_business_id, p.email as provider_email, b.shared_values, b.status, b.previous_batch_id,
            prev.title as previous_title, b.created_at
       from er_contract_batches b
       left join er_service_providers p on p.id = b.provider_id
       left join er_contract_batches prev on prev.id = b.previous_batch_id
      where b.id = $1`,
    [id],
  );
  return row ?? null;
}

export interface SignerState {
  name: string;
  email: string;
  role: string;
  status?: string;
  signedAt?: string | null;
}

export interface BatchItemRow {
  id: string;
  batch_id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  company_business_id: string;
  values: TemplateValues;
  status: ItemStatus;
  error: string | null;
  contract_id: string | null;
  document_id: string | null;
  signing_round_id: string | null;
  sealed_document_id: string | null;
  round_status: string | null;
  round_signers: SignerState[] | null;
}

export async function listBatchItems(tx: Sql, batchId: string): Promise<BatchItemRow[]> {
  return tx.query<BatchItemRow>(
    `select i.id, i.batch_id, i.organization_id, i.company_id, c.name as company_name, c.business_id as company_business_id,
            i."values", i.status, i.error, i.contract_id, i.document_id, i.signing_round_id, i.sealed_document_id,
            r.status as round_status, r.signers as round_signers
       from er_contract_batch_items i
       join er_housing_companies c on c.id = i.company_id
       left join er_signing_rounds r on r.id = i.signing_round_id
      where i.batch_id = $1
      order by c.name`,
    [batchId],
  );
}

/** Työpöydän nosto: lähetetyt, allekirjoittamattomat sopimukset. */
export async function countAwaitingSignature(tx: Sql, organizationId: string): Promise<number> {
  const [row] = await tx.query<{ n: number }>("select count(*)::int as n from er_contract_batch_items where organization_id = $1 and status = 'sent'", [organizationId]);
  return row?.n ?? 0;
}

/** Aktiiviset yhtiöt valintaan. */
export async function listActiveCompanies(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; name: string; city: string | null }>(
    "select id, name, city from er_housing_companies where organization_id = $1 and management_ended_on is null order by name",
    [organizationId],
  );
}

export async function listProviderOptions(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; name: string; business_id: string | null; email: string | null }>(
    "select id, name, business_id, email from er_service_providers where organization_id = $1 order by name",
    [organizationId],
  );
}
