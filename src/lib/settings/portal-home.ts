import type { Database } from "@/lib/db";
import type { ShareRange } from "@/lib/registry/share-ranges";

/**
 * Portaalin "Oma huoneisto" -sivun tiedot.
 *
 * Huoneistot, osakevälit, yhtiöt ja hallitukset luetaan käyttäjän
 * RLS-transaktiossa, joten näkyvyys on sama kuin portaalin muissa näkymissä.
 *
 * Poikkeus: vastuuisännöitsijän ja isännöintiyrityksen yhteystiedot.
 * Portaalikäyttäjä ei näe er_users- eikä er_organizations-rivejä (RLS), joten
 * ne haetaan palvelun roolilla. Tämä on turvallista, koska
 *  - kysely rajataan yhtiöihin, joihin käyttäjällä on voimassa oleva
 *    er_portal_access-rivi (käyttäjän id tulee istunnosta, ei syötteestä),
 *  - palautetaan vain isännöitsijän nimi, sähköposti ja puhelin sekä
 *    yrityksen nimi ja julkiset yhteystiedot, jotka ovat joka tapauksessa
 *    osakkaille annettavia tietoja (isännöitsijän yhteystiedot kuuluvat
 *    esimerkiksi isännöitsijäntodistukseen ja porrastauluun),
 *  - kysely ei ota vastaan muita parametreja, joten sillä ei voi hakea
 *    muiden yhtiöiden tai käyttäjien tietoja.
 */

export interface PortalUnit {
  share_group_id: string;
  company_id: string;
  company_name: string;
  unit_label: string;
  kind: string;
  layout: string | null;
  floor: string | null;
  area_m2: string | null;
  share_count: number;
  roles: ("owner" | "resident")[];
  /** Vain omistajalle. */
  ranges: ShareRange[] | null;
}

export interface PortalCompany {
  id: string;
  name: string;
  business_id: string;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  roles: string[];
  manager: { full_name: string | null; email: string | null; phone: string | null } | null;
  management: { name: string; phone: string | null; email: string | null } | null;
  board: { party_id: string; display_name: string; role: string }[] | null;
}

export interface PortalHome {
  units: PortalUnit[];
  companies: PortalCompany[];
}

export async function loadPortalHome(db: Database, user: { id: string; sub: string }): Promise<PortalHome> {
  const own = await db.asUser(user.sub, async (tx) => {
    const units = await tx.query<Omit<PortalUnit, "ranges"> & { all_ranges: ShareRange[] }>(
      `select g.id as share_group_id, g.company_id, c.name as company_name, g.unit_label, g.kind, g.layout, g.floor, g.area_m2, g.share_count,
              array_agg(distinct a.role) as roles,
              coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                          from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as all_ranges
         from er_portal_access a
         join er_share_groups g on g.id = a.share_group_id
         join er_housing_companies c on c.id = g.company_id
        where a.user_id = er_current_user_id() and a.role in ('owner', 'resident')
          and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
        group by g.id, c.name
        order by c.name, g.unit_label`,
    );
    const companies = await tx.query<{ id: string; name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null; roles: string[] }>(
      `select c.id, c.name, c.business_id, c.street_address, c.postal_code, c.city, array_agg(distinct a.role) as roles
         from er_portal_access a join er_housing_companies c on c.id = a.company_id
        where a.user_id = er_current_user_id()
          and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
        group by c.id order by c.name`,
    );
    const boardCompanyIds = companies.filter((c) => c.roles.includes("board")).map((c) => c.id);
    const board = boardCompanyIds.length
      ? await tx.query<{ company_id: string; party_id: string; display_name: string; role: string }>(
          `select b.company_id, p.id as party_id, p.display_name, b.role
             from er_board_memberships b join er_parties p on p.id = b.party_id
            where b.company_id = any($1::uuid[]) and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
            order by case b.role when 'chair' then 0 when 'member' then 1 when 'deputy' then 2 else 3 end, p.display_name`,
          [boardCompanyIds],
        )
      : [];
    return { units, companies, board };
  });

  const contacts = await db.asService((tx) =>
    tx.query<{
      company_id: string; manager_name: string | null; manager_email: string | null; manager_phone: string | null;
      org_name: string; org_phone: string | null; org_email: string | null;
    }>(
      `select c.id as company_id, u.full_name as manager_name, u.email as manager_email, u.phone as manager_phone,
              o.name as org_name, o.settings #>> '{contact,phone}' as org_phone, o.settings #>> '{contact,email}' as org_email
         from er_housing_companies c
         join er_organizations o on o.id = c.organization_id
         left join er_users u on u.id = c.manager_user_id
        where c.id in (select company_id from er_portal_access
                        where user_id = $1 and starts_on <= current_date and (ends_on is null or ends_on >= current_date))`,
      [user.id],
    ),
  );
  const contactMap = new Map(contacts.map((c) => [c.company_id, c]));

  return {
    units: own.units.map(({ all_ranges, ...u }) => ({ ...u, ranges: u.roles.includes("owner") ? all_ranges : null })),
    companies: own.companies.map((c) => {
      const k = contactMap.get(c.id);
      return {
        ...c,
        manager: k && (k.manager_name || k.manager_email) ? { full_name: k.manager_name, email: k.manager_email, phone: k.manager_phone } : null,
        management: k ? { name: k.org_name, phone: k.org_phone, email: k.org_email } : null,
        board: c.roles.includes("board") ? own.board.filter((b) => b.company_id === c.id).map(({ party_id, display_name, role }) => ({ party_id, display_name, role })) : null,
      };
    }),
  };
}
