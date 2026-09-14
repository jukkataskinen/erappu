import type { Sql } from "@/lib/db";

/**
 * Portaalikäyttäjät asetussivulle. Käyttäjän RLS-transaktiossa
 * (portal_access_staff: owner/manager). Portaalikäyttäjän er_users-rivi ei näy
 * henkilökunnalle, joten nimi ja sähköposti otetaan rekisterin osapuolesta,
 * johon tili on liitetty.
 */
export interface PortalUserRow {
  id: string;
  user_id: string;
  person: string | null;
  email: string | null;
  company_name: string;
  unit_label: string | null;
  role: "board" | "owner" | "resident" | "provider";
  basis: string;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
}

export async function listPortalUsers(tx: Sql, organizationId: string, includeEnded = false): Promise<PortalUserRow[]> {
  return tx.query<PortalUserRow>(
    `select a.id, a.user_id, c.name as company_name, g.unit_label, a.role, a.basis, a.starts_on, a.ends_on,
            (a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)) as active,
            (select string_agg(distinct p.display_name, ', ') from er_parties p where p.user_id = a.user_id and p.organization_id = a.organization_id) as person,
            (select min(p.email) from er_parties p where p.user_id = a.user_id and p.organization_id = a.organization_id) as email
       from er_portal_access a
       join er_housing_companies c on c.id = a.company_id
       left join er_share_groups g on g.id = a.share_group_id
      where a.organization_id = $1 and ($2::boolean or a.ends_on is null or a.ends_on >= current_date)
      order by person nulls last, c.name, g.unit_label nulls first`,
    [organizationId, includeEnded],
  );
}

export const BASIS_LABEL: Record<string, string> = {
  ownership: "Omistus",
  residency: "Asuminen",
  board: "Hallitusjäsenyys",
  provider: "Palvelusopimus",
};

export function basisLabel(basis: string): string {
  return BASIS_LABEL[basis.split(":")[0]] ?? "Muu";
}
