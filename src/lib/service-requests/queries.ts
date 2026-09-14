import type { Sql } from "@/lib/db/types";
import type { Category, CostResponsibility, EventVisibility, RequestStatus, Urgency } from "./labels";
import { OPEN_STATUSES } from "./status";

/**
 * Huoltopyyntöjen lukukyselyt. Henkilökunnan ja portaalin kyselyt ajetaan
 * käyttäjän RLS-transaktiossa; organisaatioehto rajaa näkymän valittuun
 * organisaatioon. Päivämäärät palautetaan tekstinä (VVVV-KK-PP), jotta
 * aikavyöhyke ei siirrä päivää.
 */

type Ts = string | Date;

export interface RequestListRow {
  id: string;
  number: number;
  title: string;
  category: Category;
  urgency: Urgency;
  status: RequestStatus;
  source: string;
  company_id: string;
  company_name: string;
  unit_label: string | null;
  assignee_name: string | null;
  provider_name: string | null;
  due_on: string | null;
  overdue: boolean;
  created_at: Ts;
}

export interface RequestFilters {
  status?: RequestStatus | null;
  companyId?: string | null;
  urgency?: Urgency | null;
  assigneeId?: string | null;
  providerId?: string | null;
  unassigned?: boolean;
  openOnly?: boolean;
  limit?: number;
}

const LIST_SELECT = `
  select r.id, r.number, r.title, r.category, r.urgency, r.status, r.source, r.company_id,
         c.name as company_name, coalesce(g.unit_label, r.unit_text) as unit_label,
         coalesce(u.full_name, u.email) as assignee_name, p.name as provider_name,
         r.due_on::text as due_on,
         (r.due_on is not null and r.due_on < current_date and r.status = any($1::text[])) as overdue,
         r.created_at
    from er_service_requests r
    join er_housing_companies c on c.id = r.company_id
    left join er_share_groups g on g.id = r.share_group_id
    left join er_users u on u.id = r.assignee_user_id
    left join er_service_providers p on p.id = r.provider_id`;

const URGENCY_ORDER = "case r.urgency when 'urgent' then 0 when 'normal' then 1 else 2 end";

export async function listRequests(tx: Sql, organizationId: string, f: RequestFilters = {}): Promise<RequestListRow[]> {
  const params: unknown[] = [OPEN_STATUSES, organizationId];
  const where = ["r.organization_id = $2"];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("r.status = ?", f.status);
  else if (f.openOnly) where.push("r.status = any($1::text[])");
  if (f.companyId) add("r.company_id = ?", f.companyId);
  if (f.urgency) add("r.urgency = ?", f.urgency);
  if (f.assigneeId) add("r.assignee_user_id = ?", f.assigneeId);
  if (f.providerId) add("r.provider_id = ?", f.providerId);
  if (f.unassigned) where.push("r.assignee_user_id is null");
  params.push(Math.min(f.limit ?? 300, 1000));
  return tx.query<RequestListRow>(
    `${LIST_SELECT}
      where ${where.join(" and ")}
      order by (r.status = any($1::text[])) desc, ${URGENCY_ORDER}, r.created_at desc
      limit $${params.length}`,
    params,
  );
}

export interface RequestDetail extends RequestListRow {
  organization_id: string;
  description: string;
  share_group_id: string | null;
  unit_text: string | null;
  reporter_user_id: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  reporter_email: string | null;
  may_use_master_key: boolean;
  has_pets: boolean;
  assignee_user_id: string | null;
  provider_id: string | null;
  provider_email: string | null;
  cost_responsibility: CostResponsibility;
  cost_eur: string | null;
  ordered_at: Ts | null;
  provider_acknowledged_at: Ts | null;
  completed_at: Ts | null;
  closed_at: Ts | null;
  reopened_count: number;
  company_address: string | null;
}

export async function getRequest(tx: Sql, id: string): Promise<RequestDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx.query<RequestDetail>(
    `select r.id, r.number, r.title, r.category, r.urgency, r.status, r.source, r.company_id,
            c.name as company_name, coalesce(g.unit_label, r.unit_text) as unit_label,
            coalesce(u.full_name, u.email) as assignee_name, p.name as provider_name, p.email as provider_email,
            r.due_on::text as due_on,
            (r.due_on is not null and r.due_on < current_date and r.status = any($2::text[])) as overdue,
            r.created_at, r.organization_id, r.description, r.share_group_id, r.unit_text, r.reporter_user_id,
            r.reporter_name, r.reporter_phone, r.reporter_email, r.may_use_master_key, r.has_pets,
            r.assignee_user_id, r.provider_id, r.cost_responsibility, r.cost_eur, r.ordered_at,
            r.provider_acknowledged_at, r.completed_at, r.closed_at, r.reopened_count,
            nullif(concat_ws(', ', c.street_address, nullif(concat_ws(' ', c.postal_code, c.city), '')), '') as company_address
       from er_service_requests r
       join er_housing_companies c on c.id = r.company_id
       left join er_share_groups g on g.id = r.share_group_id
       left join er_users u on u.id = r.assignee_user_id
       left join er_service_providers p on p.id = r.provider_id
      where r.id = $1`,
    [id, OPEN_STATUSES],
  );
  return row ?? null;
}

export interface EventRow {
  id: string;
  type: string;
  body: string | null;
  old_status: RequestStatus | null;
  new_status: RequestStatus | null;
  visibility: EventVisibility;
  provider_actor: boolean;
  user_id: string | null;
  actor_name: string | null;
  document_id: string | null;
  created_at: Ts;
}

/** Henkilökunnan tapahtumahistoria aikajärjestyksessä. */
export async function listEvents(tx: Sql, requestId: string): Promise<EventRow[]> {
  return tx.query<EventRow>(
    `select e.id, e.type, e.body, e.old_status, e.new_status, e.visibility, e.provider_actor, e.user_id, e.document_id, e.created_at,
            case when e.provider_actor then coalesce(p.name, 'Palveluntuottaja')
                 when e.user_id is not null and e.user_id = r.reporter_user_id then coalesce(r.reporter_name, 'Ilmoittaja')
                 else coalesce(u.full_name, u.email) end as actor_name
       from er_service_request_events e
       join er_service_requests r on r.id = e.request_id
       left join er_users u on u.id = e.user_id
       left join er_service_providers p on p.id = r.provider_id
      where e.request_id = $1
      order by e.created_at, e.id`,
    [requestId],
  );
}

/**
 * Portaalin tapahtumat. RLS rajaa jo näkyvyyden, mutta ehto on myös tässä,
 * koska henkilökuntaan kuuluva ilmoittaja näkisi muuten sisäiset merkinnät.
 */
export async function listPortalEvents(tx: Sql, requestId: string, userId: string, board: boolean): Promise<EventRow[]> {
  return tx.query<EventRow>(
    `select e.id, e.type, e.body, e.old_status, e.new_status, e.visibility, e.provider_actor, e.user_id, e.document_id, e.created_at,
            case when e.provider_actor then 'Palveluntuottaja'
                 when e.user_id = $2 then 'Sinä'
                 else 'Isännöinti' end as actor_name
       from er_service_request_events e
      where e.request_id = $1 and e.visibility = any($3::text[])
      order by e.created_at, e.id`,
    [requestId, userId, board ? ["reporter", "board"] : ["reporter"]],
  );
}

export interface PhotoRow {
  id: string;
  visibility: string;
  created_at: Ts;
}

export async function listPhotos(tx: Sql, requestId: string, visibilities?: string[]): Promise<PhotoRow[]> {
  return tx.query<PhotoRow>(
    `select id, visibility, created_at from er_documents
      where subject_table = 'er_service_requests' and subject_id = $1 and category = 'photo'
        and ($2::text[] is null or visibility = any($2::text[]))
      order by created_at`,
    [requestId, visibilities ?? null],
  );
}

export interface ProviderRow {
  id: string;
  name: string;
  business_id: string | null;
  email: string | null;
  phone: string | null;
  emergency_phone: string | null;
  trades: string[];
  notes: string | null;
  company_count: number;
  open_requests: number;
}

export async function listProviders(tx: Sql, organizationId: string): Promise<ProviderRow[]> {
  return tx.query<ProviderRow>(
    `select p.id, p.name, p.business_id, p.email, p.phone, p.emergency_phone, p.trades, p.notes,
            (select count(distinct s.company_id)::int from er_company_services s where s.provider_id = p.id) as company_count,
            (select count(*)::int from er_service_requests r where r.provider_id = p.id and r.status = any($2::text[])) as open_requests
       from er_service_providers p
      where p.organization_id = $1
      order by p.name`,
    [organizationId, OPEN_STATUSES],
  );
}

export async function getProvider(tx: Sql, id: string): Promise<ProviderRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx.query<ProviderRow>(
    `select p.id, p.name, p.business_id, p.email, p.phone, p.emergency_phone, p.trades, p.notes, 0 as company_count, 0 as open_requests
       from er_service_providers p where p.id = $1`,
    [id],
  );
  return row ?? null;
}

export interface CompanyServiceRow {
  id: string;
  company_id: string;
  company_name: string;
  provider_id: string;
  provider_name: string;
  service: string;
  default_for_requests: boolean;
}

export async function listCompanyServices(tx: Sql, opts: { providerId?: string; companyId?: string }): Promise<CompanyServiceRow[]> {
  return tx.query<CompanyServiceRow>(
    `select s.id, s.company_id, c.name as company_name, s.provider_id, p.name as provider_name, s.service, s.default_for_requests
       from er_company_services s
       join er_housing_companies c on c.id = s.company_id
       join er_service_providers p on p.id = s.provider_id
      where ($1::uuid is null or s.provider_id = $1) and ($2::uuid is null or s.company_id = $2)
      order by c.name, s.service`,
    [opts.providerId ?? null, opts.companyId ?? null],
  );
}

/** Yhtiön oletuspalveluntuottaja huoltopyynnöille (ensimmäinen, jos useita). */
export async function defaultProviderId(tx: Sql, companyId: string): Promise<string | null> {
  const [row] = await tx.query<{ provider_id: string }>(
    "select provider_id from er_company_services where company_id = $1 and default_for_requests order by created_at limit 1",
    [companyId],
  );
  return row?.provider_id ?? null;
}

export async function listCompanyOptions(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; name: string }>(
    "select id, name from er_housing_companies where organization_id = $1 and management_ended_on is null order by name",
    [organizationId],
  );
}

export async function listShareGroupOptions(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; company_id: string; company_name: string; unit_label: string }>(
    `select g.id, g.company_id, c.name as company_name, g.unit_label
       from er_share_groups g join er_housing_companies c on c.id = g.company_id
      where g.organization_id = $1 and g.removed_on is null and c.management_ended_on is null
      order by c.name, length(g.unit_label), g.unit_label`,
    [organizationId],
  );
}

export interface PortalRequestRow {
  id: string;
  number: number;
  title: string;
  category: Category;
  urgency: Urgency;
  status: RequestStatus;
  company_name: string;
  unit_label: string | null;
  created_at: Ts;
  updated_at: Ts;
  mine: boolean;
}

/** Portaalin pyynnöt: omat ja hallituksen jäsenelle yhtiön pyynnöt (RLS). */
export async function listPortalRequests(tx: Sql, userId: string, opts: { openOnly?: boolean; limit?: number } = {}): Promise<PortalRequestRow[]> {
  return tx.query<PortalRequestRow>(
    `select r.id, r.number, r.title, r.category, r.urgency, r.status, c.name as company_name,
            coalesce(g.unit_label, r.unit_text) as unit_label, r.created_at, r.updated_at,
            coalesce(r.reporter_user_id = $1, false) as mine
       from er_service_requests r
       join er_housing_companies c on c.id = r.company_id
       left join er_share_groups g on g.id = r.share_group_id
      where (r.reporter_user_id = $1 or r.company_id in (select er_portal_company_ids(array['board'])))
        and ($2::boolean = false or r.status = any($3::text[]))
      order by coalesce(r.reporter_user_id = $1, false) desc, (r.status = any($3::text[])) desc, r.created_at desc
      limit $4`,
    [userId, opts.openOnly ?? false, OPEN_STATUSES, opts.limit ?? 200],
  );
}

export interface EmergencyContact {
  company_id: string;
  provider_name: string;
  emergency_phone: string;
}

export async function listEmergencyContacts(tx: Sql): Promise<EmergencyContact[]> {
  return tx.query<EmergencyContact>("select company_id, provider_name, emergency_phone from er_portal_emergency_contacts()");
}
