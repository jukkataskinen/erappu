import type { Sql } from "@/lib/db";

/**
 * Portaalioikeuksien ylläpito.
 *
 * Oikeus perustuu aina rekisteririviin: omistukseen, asumiseen tai
 * hallitusjäsenyyteen. Kun peruste päättyy, oikeus päättyy samana päivänä.
 * Tätä kutsutaan jokaisen omistus-, asumis- tai hallitusmuutoksen jälkeen
 * sekä HTJ-synkronoinnissa.
 *
 * Oikeus syntyy vain osapuolelle, jolla on käyttäjätili (`er_parties.user_id`).
 * Tili liitetään osapuoleen kutsun hyväksymisessä.
 */
export async function syncPortalAccessForGroup(tx: Sql, shareGroupId: string): Promise<void> {
  await tx.query(
    `with desired as (
        select o.organization_id, p.user_id, g.company_id, g.id as share_group_id, 'owner'::text as role, 'ownership:' || o.id as basis
          from er_ownerships o join er_parties p on p.id = o.party_id join er_share_groups g on g.id = o.share_group_id
         where g.id = $1 and p.user_id is not null and (o.ends_on is null or o.ends_on >= current_date)
        union all
        select r.organization_id, p.user_id, g.company_id, g.id, 'resident', 'residency:' || r.id
          from er_residencies r join er_parties p on p.id = r.party_id join er_share_groups g on g.id = r.share_group_id
         where g.id = $1 and p.user_id is not null and (r.ends_on is null or r.ends_on >= current_date)
      ),
      ended as (
        update er_portal_access a set ends_on = current_date - 1
         where a.share_group_id = $1 and a.ends_on is null
           and not exists (select 1 from desired d where d.user_id = a.user_id and d.basis = a.basis)
        returning a.id
      )
      insert into er_portal_access (organization_id, user_id, company_id, share_group_id, role, basis)
      select organization_id, user_id, company_id, share_group_id, role, basis from desired
      on conflict (user_id, company_id, role, basis) do update set ends_on = null`,
    [shareGroupId],
  );
}

export async function syncPortalAccessForBoard(tx: Sql, companyId: string): Promise<void> {
  await tx.query(
    `with desired as (
        select b.organization_id, p.user_id, b.company_id, 'board:' || b.id as basis
          from er_board_memberships b join er_parties p on p.id = b.party_id
         where b.company_id = $1 and p.user_id is not null and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
      ),
      ended as (
        update er_portal_access a set ends_on = current_date - 1
         where a.company_id = $1 and a.role = 'board' and a.ends_on is null
           and not exists (select 1 from desired d where d.user_id = a.user_id and d.basis = a.basis)
        returning a.id
      )
      insert into er_portal_access (organization_id, user_id, company_id, role, basis)
      select organization_id, user_id, company_id, 'board', basis from desired
      on conflict (user_id, company_id, role, basis) do update set ends_on = null`,
    [companyId],
  );
}
