import type { Sql } from "@/lib/db";
import { resolveAccessLink } from "@/lib/security/access-links";
import type { Category } from "@/lib/service-requests/labels";
import type { MarketplaceProvider } from "./mutations";
import type { ListingStatus } from "./rules";

/**
 * Torin luku. Palveluntuottajan kyselyt ajetaan palvelun roolilla torilinkin
 * kautta, joten jokainen niistä rajaa organisaation, hyväksynnän ja yhtiön
 * torisäännöt itse. Ennen varausta palautetaan vain ala, paikkakunta,
 * isännöitsijän kirjoittama kuvaus ja päivä.
 */

export async function resolveMarketplaceProvider(tx: Sql, token: string): Promise<MarketplaceProvider | null> {
  const link = await resolveAccessLink(tx, token, "provider_marketplace");
  if (!link || link.subjectTable !== "er_service_providers") return null;
  const [p] = await tx.query<{ id: string; organization_id: string; name: string; hourly_rate_eur: string | null }>(
    "select id, organization_id, name, hourly_rate_eur::text from er_service_providers where id = $1 and organization_id = $2",
    [link.subjectId, link.organizationId],
  );
  if (!p) return null;
  return { id: p.id, organizationId: p.organization_id, name: p.name, hourlyRateEur: p.hourly_rate_eur === null ? null : Number(p.hourly_rate_eur) };
}

export interface OpenListing {
  id: string;
  category: Category;
  city: string | null;
  summary: string;
  listed_at: string;
}

/** Torilla olevat työt, jotka palveluntuottaja saa nähdä. */
export async function listOpenForProvider(tx: Sql, provider: MarketplaceProvider): Promise<OpenListing[]> {
  return tx.query<OpenListing>(
    `select l.id, r.category, c.city, l.summary, l.listed_at
       from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id
       join er_housing_companies c on c.id = l.company_id
      where l.organization_id = $1 and l.status = 'open' and c.marketplace_enabled and c.management_ended_on is null
        and r.urgency <> 'urgent' and r.status not in ('done', 'closed', 'rejected')
        and exists (select 1 from er_marketplace_approvals a
                     where a.provider_id = $2 and a.organization_id = l.organization_id and (a.company_id is null or a.company_id = l.company_id))
      order by l.listed_at desc
      limit 200`,
    [provider.organizationId, provider.id],
  );
}

export interface ProviderReservation {
  id: string;
  status: ListingStatus;
  category: Category;
  company_name: string;
  city: string | null;
  summary: string;
  estimated_on: string | null;
  estimated_hours: string | null;
  reserve_expires_at: string | null;
  request_status: string;
}

/** Palveluntuottajan omat voimassa olevat ja viimeaikaiset varaukset. */
export async function listProviderReservations(tx: Sql, provider: MarketplaceProvider): Promise<ProviderReservation[]> {
  return tx.query<ProviderReservation>(
    `select l.id, l.status, r.category, c.name as company_name, c.city, l.summary, l.estimated_on::text, l.estimated_hours::text,
            l.reserve_expires_at, r.status as request_status
       from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id
       join er_housing_companies c on c.id = l.company_id
      where l.organization_id = $1 and l.provider_id = $2
        and (l.status in ('pending_approval', 'reserved') or (l.status = 'completed' and l.closed_at > now() - interval '30 days'))
      order by case l.status when 'reserved' then 0 when 'pending_approval' then 1 else 2 end, l.reserved_at desc`,
    [provider.organizationId, provider.id],
  );
}

export interface StaffListing {
  id: string;
  status: ListingStatus;
  summary: string;
  listed_at: string;
  provider_id: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  reserved_at: string | null;
  reserve_expires_at: string | null;
  estimated_on: string | null;
  estimated_hours: string | null;
  hourly_rate_eur: string | null;
  limit_eur: string | null;
}

export async function getListingForRequest(tx: Sql, requestId: string): Promise<StaffListing | null> {
  const [row] = await tx.query<StaffListing>(
    `select l.id, l.status, l.summary, l.listed_at, l.provider_id, p.name as provider_name, p.phone as provider_phone, l.reserved_at, l.reserve_expires_at,
            l.estimated_on::text, l.estimated_hours::text, l.hourly_rate_eur::text, c.marketplace_limit_eur::text as limit_eur
       from er_marketplace_listings l
       join er_housing_companies c on c.id = l.company_id
       left join er_service_providers p on p.id = l.provider_id
      where l.request_id = $1`,
    [requestId],
  );
  return row ?? null;
}

export interface PendingApproval {
  id: string;
  request_id: string;
  request_number: number;
  company_id: string;
  company_name: string;
  provider_name: string;
  estimated_hours: string;
  hourly_rate_eur: string;
  limit_eur: string;
  reserved_at: string | null;
}

export async function listPendingApprovals(tx: Sql, organizationId: string): Promise<PendingApproval[]> {
  return tx.query<PendingApproval>(
    `select l.id, l.request_id, r.number as request_number, c.id as company_id, c.name as company_name, p.name as provider_name, l.estimated_hours::text, l.hourly_rate_eur::text,
            l.reserved_at::text,
            c.marketplace_limit_eur::text as limit_eur
       from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id
       join er_housing_companies c on c.id = l.company_id
       join er_service_providers p on p.id = l.provider_id
      where l.organization_id = $1 and l.status = 'pending_approval'
      order by l.reserved_at`,
    [organizationId],
  );
}

export interface CompanyMarketplace {
  marketplace_enabled: boolean;
  marketplace_limit_eur: string | null;
  marketplace_decided_on: string | null;
  marketplace_decision_note: string | null;
}

export async function getCompanyMarketplace(tx: Sql, companyId: string): Promise<CompanyMarketplace | null> {
  const [row] = await tx.query<CompanyMarketplace>(
    `select marketplace_enabled, marketplace_limit_eur::text, marketplace_decided_on::text, marketplace_decision_note
       from er_housing_companies where id = $1`,
    [companyId],
  );
  return row ?? null;
}

export interface ProviderMarketplaceInfo {
  hourly_rate_eur: string | null;
  org_wide: boolean;
  company_ids: string[];
  link_expires_at: string | null;
  link_last_used_at: string | null;
}

export async function getProviderMarketplace(tx: Sql, providerId: string): Promise<ProviderMarketplaceInfo> {
  const [row] = await tx.query<ProviderMarketplaceInfo>(
    `select p.hourly_rate_eur::text,
            exists (select 1 from er_marketplace_approvals a where a.provider_id = p.id and a.company_id is null) as org_wide,
            coalesce((select array_agg(a.company_id::text) from er_marketplace_approvals a where a.provider_id = p.id and a.company_id is not null), '{}') as company_ids,
            (select l.expires_at from er_access_links l where l.subject_table = 'er_service_providers' and l.subject_id = p.id and l.purpose = 'provider_marketplace'
               and l.revoked_at is null order by l.created_at desc limit 1) as link_expires_at,
            (select l.last_used_at from er_access_links l where l.subject_table = 'er_service_providers' and l.subject_id = p.id and l.purpose = 'provider_marketplace'
               and l.revoked_at is null order by l.created_at desc limit 1) as link_last_used_at
       from er_service_providers p where p.id = $1`,
    [providerId],
  );
  return row ?? { hourly_rate_eur: null, org_wide: false, company_ids: [], link_expires_at: null, link_last_used_at: null };
}
