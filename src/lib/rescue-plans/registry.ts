import type { Sql } from "@/lib/db";
import { loadSafetyInfo, type SafetyInfo } from "@/lib/registry/safety";

/**
 * Pelastussuunnitelman esitäytön lähtötiedot rekisteristä. Luetaan käyttäjän
 * RLS-transaktiossa; esitäyttö itse on puhdas funktio (prefill.ts), jotta sen
 * voi testata ilman kantaa.
 */

export interface RegistryBuilding {
  label: string | null;
  building_type: string | null;
  completed_year: number | null;
  floors: number | null;
  staircases: number | null;
  elevators: number | null;
  construction_material: string | null;
  roof_type: string | null;
  roof_material: string | null;
  heating: string | null;
  heating_type: string | null;
  heat_distribution: string | null;
  ventilation: string | null;
  floor_area_m2: string | null;
  common_spaces: string[];
}

export interface RegistrySnapshot {
  company: {
    name: string;
    business_id: string;
    street_address: string | null;
    postal_code: string | null;
    city: string | null;
    property_maintenance: string | null;
    parking_hall_spaces: number | null;
    parking_other_spaces: number | null;
  };
  organization: { name: string; phone: string | null; email: string | null };
  manager: { name: string | null; email: string | null; phone: string | null } | null;
  chair: { name: string; email: string | null; phone: string | null } | null;
  propertyCodes: string[];
  parkingBuilt: number | null;
  buildings: RegistryBuilding[];
  units: { apartments: number; commercial: number; parking: number; storage: number; other: number };
  /** Voimassa olevat asumiset (henkilöt), arvion pohja. Tyhjä rekisteri → 0. */
  residents: number;
  maintenanceProviders: { name: string; phone: string | null; emergency_phone: string | null; email: string | null; service: string }[];
  /** Väestönsuoja, kokoontumispaikat ja pääsulut rekisteristä (0108). */
  safety?: SafetyInfo | null;
}

export async function loadRegistrySnapshot(tx: Sql, companyId: string, today: string): Promise<RegistrySnapshot | null> {
  const [company] = await tx.query<RegistrySnapshot["company"] & {
    org_name: string; org_settings: { contact?: Record<string, string | null> } | null;
    manager_name: string | null; manager_email: string | null; manager_phone: string | null;
  }>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, c.property_maintenance, c.parking_hall_spaces, c.parking_other_spaces,
            o.name as org_name, o.settings as org_settings,
            coalesce(u.full_name, u.email) as manager_name, coalesce(u.contact_email, u.email) as manager_email, u.phone as manager_phone
       from er_housing_companies c
       join er_organizations o on o.id = c.organization_id
       left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [companyId],
  );
  if (!company) return null;

  const [chairs, properties, buildings, units, residents, providers, safety] = await Promise.all([
    tx.query<{ name: string; email: string | null; phone: string | null }>(
      `select p.display_name as name, p.email, p.phone
         from er_board_memberships b join er_parties p on p.id = b.party_id
        where b.company_id = $1 and b.role = 'chair' and b.starts_on <= $2::date and (b.ends_on is null or b.ends_on >= $2::date)
        order by b.starts_on desc limit 1`,
      [companyId, today],
    ),
    tx.query<{ property_code: string; parking_spaces_built: number | null }>(
      "select property_code, parking_spaces_built from er_properties where company_id = $1 order by property_code",
      [companyId],
    ),
    tx.query<RegistryBuilding>(
      `select label, building_type, completed_year, floors, staircases, elevators, construction_material, roof_type, roof_material,
              heating, heating_type, heat_distribution, ventilation, floor_area_m2::text, common_spaces
         from er_buildings where company_id = $1 order by label nulls first`,
      [companyId],
    ),
    tx.query<{ kind: string; n: number }>(
      "select kind, count(*)::int as n from er_share_groups where company_id = $1 and removed_on is null group by kind",
      [companyId],
    ),
    tx.query<{ n: number }>(
      `select count(distinct r.party_id)::int as n
         from er_residencies r join er_share_groups g on g.id = r.share_group_id
        where g.company_id = $1 and g.removed_on is null and (r.starts_on is null or r.starts_on <= $2::date) and (r.ends_on is null or r.ends_on >= $2::date)`,
      [companyId, today],
    ),
    tx.query<{ name: string; phone: string | null; emergency_phone: string | null; email: string | null; service: string }>(
      `select p.name, p.phone, p.emergency_phone, p.email, s.service
         from er_company_services s join er_service_providers p on p.id = s.provider_id
        where s.company_id = $1
        order by (s.service ilike '%huolto%') desc, s.default_for_requests desc, p.name`,
      [companyId],
    ),
    loadSafetyInfo(tx, companyId),
  ]);

  const count = (kinds: string[]) => units.filter((u) => kinds.includes(u.kind)).reduce((s, u) => s + u.n, 0);
  const contact = company.org_settings?.contact ?? {};
  const built = properties.map((p) => p.parking_spaces_built).filter((n): n is number => n !== null);
  return {
    company: {
      name: company.name,
      business_id: company.business_id,
      street_address: company.street_address,
      postal_code: company.postal_code,
      city: company.city,
      property_maintenance: company.property_maintenance,
      parking_hall_spaces: company.parking_hall_spaces,
      parking_other_spaces: company.parking_other_spaces,
    },
    organization: { name: company.org_name, phone: contact.phone ?? null, email: contact.email ?? null },
    manager: company.manager_name ? { name: company.manager_name, email: company.manager_email, phone: company.manager_phone } : null,
    chair: chairs[0] ?? null,
    propertyCodes: properties.map((p) => p.property_code),
    parkingBuilt: built.length ? built.reduce((s, n) => s + n, 0) : null,
    buildings,
    units: {
      apartments: count(["apartment"]),
      commercial: count(["commercial"]),
      parking: count(["parking", "garage"]),
      storage: count(["storage"]),
      other: count(["other"]),
    },
    residents: residents[0]?.n ?? 0,
    maintenanceProviders: providers,
    safety,
  };
}
