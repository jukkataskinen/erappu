import type { Sql } from "@/lib/db";
import type { ShareRange } from "./share-ranges";

/**
 * Rekisterin lukukyselyt. Kaikki ajetaan käyttäjän RLS-transaktiossa, joten
 * organisaatiorajaus tulee kannasta; `organization_id`-ehto on mukana vain
 * silloin, kun käyttäjä kuuluu useaan organisaatioon ja valinta rajaa näkymän.
 */

export interface CompanyListRow {
  id: string;
  name: string;
  business_id: string;
  company_form: string;
  city: string | null;
  total_shares: number | null;
  unit_count: number;
  apartment_count: number;
  shares_in_units: number;
  missing_ranges: number;
  manager_name: string | null;
  htj_synced_at: string | null;
}

export async function listCompanies(tx: Sql, organizationId: string): Promise<CompanyListRow[]> {
  return tx.query<CompanyListRow>(
    `select c.id, c.name, c.business_id, c.company_form, c.city, c.total_shares, c.htj_synced_at,
            coalesce(u.full_name, u.email) as manager_name,
            (select count(*)::int from er_share_groups g where g.company_id = c.id and g.removed_on is null) as unit_count,
            (select count(*)::int from er_share_groups g where g.company_id = c.id and g.removed_on is null and g.kind = 'apartment') as apartment_count,
            (select coalesce(sum(g.share_count), 0)::int from er_share_groups g where g.company_id = c.id and g.removed_on is null) as shares_in_units,
            (select count(*)::int from er_share_groups g where g.company_id = c.id and g.removed_on is null and g.share_count = 0) as missing_ranges
       from er_housing_companies c
       left join er_users u on u.id = c.manager_user_id
      where c.organization_id = $1 and c.management_ended_on is null
      order by c.name`,
    [organizationId],
  );
}

export interface Company {
  id: string;
  organization_id: string;
  name: string;
  business_id: string;
  company_form: "asunto_oy" | "koy" | "other";
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  articles_date: string | Date | null;
  fiscal_year_start: string;
  total_shares: number | null;
  manager_user_id: string | null;
  management_started_on: string | Date | null;
  redemption_clause: Record<string, boolean>;
  same_charge_basis: boolean | null;
  insurance_company: string | null;
  insurance_type: string | null;
  property_maintenance: string | null;
  commercial_register_note: string | null;
  htj_id: string | null;
  htj_synced_at: string | null;
  extra: Record<string, unknown>;
}

export async function getCompany(tx: Sql, id: string): Promise<Company | null> {
  const [row] = await tx.query<Company>("select * from er_housing_companies where id = $1", [id]);
  return row ?? null;
}

export interface ShareGroupRow {
  id: string;
  unit_label: string;
  kind: string;
  layout: string | null;
  floor: string | null;
  area_m2: string | null;
  intended_use: string | null;
  share_count: number;
  is_rented: boolean;
  building_label: string | null;
  source: string;
  ranges: ShareRange[];
  owners: string | null;
  residents: string | null;
}

export async function listShareGroups(tx: Sql, companyId: string): Promise<ShareGroupRow[]> {
  return tx.query<ShareGroupRow>(
    `select g.id, g.unit_label, g.kind, g.layout, g.floor, g.area_m2, g.intended_use, g.share_count, g.is_rented, g.source,
            b.label as building_label,
            coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                        from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges,
            (select string_agg(p.display_name, ', ' order by p.display_name)
               from er_ownerships o join er_parties p on p.id = o.party_id
              where o.share_group_id = g.id and (o.ends_on is null or o.ends_on >= current_date)) as owners,
            (select string_agg(p.display_name, ', ' order by p.display_name)
               from er_residencies r join er_parties p on p.id = r.party_id
              where r.share_group_id = g.id and (r.ends_on is null or r.ends_on >= current_date)) as residents
       from er_share_groups g
       left join er_buildings b on b.id = g.building_id
      where g.company_id = $1 and g.removed_on is null
      order by coalesce(b.label, ''), length(g.unit_label), g.unit_label`,
    [companyId],
  );
}

export interface OwnerRow {
  ownership_id: string;
  party_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  unit_label: string;
  share_group_id: string;
  share_numerator: number;
  share_denominator: number;
  share_count: number;
  starts_on: string | null;
  source: string;
  has_portal: boolean;
}

export async function listOwners(tx: Sql, companyId: string): Promise<OwnerRow[]> {
  return tx.query<OwnerRow>(
    `select o.id as ownership_id, p.id as party_id, p.display_name, p.email, p.phone, p.street_address, p.postal_code, p.city,
            g.unit_label, g.id as share_group_id, o.share_numerator, o.share_denominator, g.share_count, o.starts_on, o.source,
            (p.user_id is not null) as has_portal
       from er_ownerships o
       join er_share_groups g on g.id = o.share_group_id
       join er_parties p on p.id = o.party_id
      where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= current_date)
      order by p.display_name, g.unit_label`,
    [companyId],
  );
}

export interface BoardRow {
  id: string;
  party_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  starts_on: string;
  ends_on: string | null;
}

export async function listBoard(tx: Sql, companyId: string, includeEnded = false): Promise<BoardRow[]> {
  return tx.query<BoardRow>(
    `select b.id, p.id as party_id, p.display_name, p.email, p.phone, b.role, b.starts_on, b.ends_on
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and ($2::boolean or b.ends_on is null or b.ends_on >= current_date)
      order by case b.role when 'chair' then 0 when 'member' then 1 when 'deputy' then 2 else 3 end, p.display_name`,
    [companyId, includeEnded],
  );
}

export interface BuildingRow {
  id: string;
  label: string | null;
  building_type: string | null;
  completed_year: number | null;
  floors: number | null;
  apartment_area_m2: string | null;
  floor_area_m2: string | null;
  volume_m3: string | null;
  construction_material: string | null;
  roof_type: string | null;
  roof_material: string | null;
  heating: string | null;
  ventilation: string | null;
  energy_class: string | null;
  energy_certificate_year: number | null;
  common_spaces: string[];
}

export async function listBuildings(tx: Sql, companyId: string): Promise<BuildingRow[]> {
  return tx.query<BuildingRow>("select * from er_buildings where company_id = $1 order by label nulls first", [companyId]);
}

export async function listProperties(tx: Sql, companyId: string) {
  return tx.query<{ id: string; property_code: string; tenure: string | null; area_m2: string | null; parking_spaces_planned: number | null; parking_spaces_built: number | null; unused_building_rights_m2: string | null }>(
    "select * from er_properties where company_id = $1 order by property_code",
    [companyId],
  );
}

export async function listStaff(tx: Sql, organizationId: string) {
  return tx.query<{ id: string; name: string; role: string }>(
    `select u.id, coalesce(u.full_name, u.email) as name, m.role
       from er_org_members m join er_users u on u.id = m.user_id
      where m.organization_id = $1 order by name`,
    [organizationId],
  );
}
