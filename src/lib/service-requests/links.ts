import "server-only";
import type { Sql } from "@/lib/db";
import { createAccessLink, resolveAccessLink } from "@/lib/security/access-links";
import { decryptField, encryptField } from "@/lib/security/crypto";
import { appBaseUrl } from "./messages";
import type { Category, RequestStatus, Urgency } from "./labels";

/**
 * Kirjautumattomat reitit: julkinen QR-lomake ja palveluntuottajan
 * tehtävälinkki. Ratkaisu tehdään palvelun roolilla, joten jokainen kysely
 * rajataan tarkasti linkin kohteeseen (subject_table + subject_id +
 * organisaatio). Linkin kohdetta ei koskaan oteta lomakkeelta.
 */

// ---------------------------------------------------------------------------
// Julkinen lomake
// ---------------------------------------------------------------------------

export function publicFormUrl(token: string): string {
  return `${appBaseUrl()}/ilmoita/${token}`;
}

/** Henkilökunnan näkymä: nykyinen lomakelinkki (RLS-transaktio). */
export async function getPublicFormToken(tx: Sql, companyId: string): Promise<{ token: string; createdAt: string | Date } | null> {
  const [row] = await tx.query<{ token_encrypted: string; created_at: string | Date }>(
    `select f.token_encrypted, f.created_at from er_public_request_forms f
       join er_access_links l on l.id = f.access_link_id
      where f.company_id = $1 and l.revoked_at is null`,
    [companyId],
  );
  if (!row) return null;
  try {
    return { token: decryptField(row.token_encrypted), createdAt: row.created_at };
  } catch {
    return null;
  }
}

/** Luo lomakelinkin tai vaihtaa sen; vanha linkki lakkaa toimimasta heti. */
export async function rotatePublicFormLink(tx: Sql, opts: { companyId: string; userId: string }): Promise<string> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [opts.companyId]);
  if (!company) throw new Error("Yhtiötä ei löytynyt.");
  await tx.query(
    `update er_access_links set revoked_at = now()
      where purpose = 'public_request_form' and subject_table = 'er_housing_companies' and subject_id = $1 and revoked_at is null`,
    [opts.companyId],
  );
  const token = await createAccessLink(tx, {
    organizationId: company.organization_id, purpose: "public_request_form", subjectTable: "er_housing_companies",
    subjectId: opts.companyId, expiresInDays: null, createdBy: opts.userId,
  });
  const [link] = await tx.query<{ id: string }>(
    "select id from er_access_links where subject_table = 'er_housing_companies' and subject_id = $1 and purpose = 'public_request_form' and revoked_at is null order by created_at desc limit 1",
    [opts.companyId],
  );
  await tx.query(
    `insert into er_public_request_forms (organization_id, company_id, access_link_id, token_encrypted, created_by)
     values ($1,$2,$3,$4,$5)
     on conflict (company_id) do update set access_link_id = excluded.access_link_id, token_encrypted = excluded.token_encrypted,
        created_by = excluded.created_by, created_at = now()`,
    [company.organization_id, opts.companyId, link.id, encryptField(token), opts.userId],
  );
  return token;
}

export interface PublicFormTarget {
  organizationId: string;
  companyId: string;
  companyName: string;
  linkId: string;
}

/** Palvelun roolilla. Palauttaa null, jos linkki ei ole voimassa. */
export async function resolvePublicForm(tx: Sql, token: string): Promise<PublicFormTarget | null> {
  const link = await resolveAccessLink(tx, token, "public_request_form");
  if (!link || link.subjectTable !== "er_housing_companies") return null;
  const [company] = await tx.query<{ id: string; name: string }>(
    `select c.id, c.name from er_housing_companies c
       join er_public_request_forms f on f.company_id = c.id and f.access_link_id = $3
      where c.id = $1 and c.organization_id = $2 and c.management_ended_on is null`,
    [link.subjectId, link.organizationId, link.id],
  );
  if (!company) return null;
  return { organizationId: link.organizationId, companyId: company.id, companyName: company.name, linkId: link.id };
}

/** Yhtiön oletuspalveluntuottajan päivystysnumero julkiselle lomakkeelle (palvelun roolilla). */
export async function emergencyContactForCompany(tx: Sql, target: PublicFormTarget): Promise<{ name: string; phone: string } | null> {
  const [row] = await tx.query<{ name: string; emergency_phone: string }>(
    `select p.name, p.emergency_phone from er_company_services s
       join er_service_providers p on p.id = s.provider_id
      where s.company_id = $1 and s.organization_id = $2 and s.default_for_requests and p.emergency_phone is not null
      order by s.created_at limit 1`,
    [target.companyId, target.organizationId],
  );
  return row ? { name: row.name, phone: row.emergency_phone } : null;
}

// ---------------------------------------------------------------------------
// Palveluntuottajan tehtävä
// ---------------------------------------------------------------------------

export interface ProviderTask {
  linkId: string;
  requestId: string;
  organizationId: string;
  companyId: string;
  number: number;
  title: string;
  description: string;
  category: Category;
  urgency: Urgency;
  status: RequestStatus;
  companyName: string;
  address: string | null;
  unitLabel: string | null;
  mayUseMasterKey: boolean;
  hasPets: boolean;
  /** Vain ilmoittajan itse antama puhelinnumero; ei muita henkilötietoja. */
  reporterPhone: string | null;
  dueOn: string | null;
  providerName: string;
  costEur: string | null;
  acknowledgedAt: string | Date | null;
}

/** Palvelun roolilla. Rajaus: linkin organisaatio, pyyntö ja nykyinen palveluntuottaja. */
export async function resolveProviderTask(tx: Sql, token: string): Promise<ProviderTask | null> {
  const link = await resolveAccessLink(tx, token, "provider_task");
  if (!link || link.subjectTable !== "er_service_requests") return null;
  const [r] = await tx.query<{
    id: string; organization_id: string; company_id: string; number: number; title: string; description: string; category: Category;
    urgency: Urgency; status: RequestStatus; company_name: string; address: string | null; unit_label: string | null;
    may_use_master_key: boolean; has_pets: boolean; reporter_phone: string | null; due_on: string | null; provider_name: string;
    cost_eur: string | null; provider_acknowledged_at: string | Date | null;
  }>(
    `select r.id, r.organization_id, r.company_id, r.number, r.title, r.description, r.category, r.urgency, r.status,
            c.name as company_name,
            nullif(concat_ws(', ', c.street_address, nullif(concat_ws(' ', c.postal_code, c.city), '')), '') as address,
            coalesce(g.unit_label, r.unit_text) as unit_label, r.may_use_master_key, r.has_pets, r.reporter_phone,
            r.due_on::text as due_on, p.name as provider_name, r.cost_eur, r.provider_acknowledged_at
       from er_service_requests r
       join er_housing_companies c on c.id = r.company_id
       join er_service_providers p on p.id = r.provider_id and p.organization_id = r.organization_id
       left join er_share_groups g on g.id = r.share_group_id
      where r.id = $1 and r.organization_id = $2`,
    [link.subjectId, link.organizationId],
  );
  if (!r) return null;
  return {
    linkId: link.id, requestId: r.id, organizationId: r.organization_id, companyId: r.company_id, number: r.number, title: r.title,
    description: r.description, category: r.category, urgency: r.urgency, status: r.status, companyName: r.company_name, address: r.address,
    unitLabel: r.unit_label, mayUseMasterKey: r.may_use_master_key, hasPets: r.has_pets, reporterPhone: r.reporter_phone, dueOn: r.due_on,
    providerName: r.provider_name, costEur: r.cost_eur, acknowledgedAt: r.provider_acknowledged_at,
  };
}

/**
 * Tehtävälinkin näkymän tapahtumat ilman henkilöiden nimiä: palveluntuottajalle
 * osoitetut kommentit, tilamuutokset ja palveluntuottajan omat merkinnät.
 * Ilmoittajan ja isännöinnin väliset kommentit eivät näy.
 */
export async function listProviderEvents(tx: Sql, requestId: string) {
  return tx.query<{ id: string; type: string; body: string | null; old_status: RequestStatus | null; new_status: RequestStatus | null; provider_actor: boolean; created_at: string | Date }>(
    `select id, type, body, old_status, new_status, provider_actor, created_at
       from er_service_request_events
      where request_id = $1 and type <> 'attachment'
        and (visibility = 'provider' or provider_actor or (type = 'status_change' and visibility <> 'internal'))
      order by created_at, id`,
    [requestId],
  );
}

export async function listProviderPhotos(tx: Sql, requestId: string, organizationId: string) {
  return tx.query<{ id: string }>(
    `select id from er_documents
      where subject_table = 'er_service_requests' and subject_id = $1 and organization_id = $2
        and category = 'photo' and visibility in ('reporter', 'provider')
      order by created_at`,
    [requestId, organizationId],
  );
}
