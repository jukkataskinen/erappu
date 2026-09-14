import type { Sql } from "@/lib/db";

export interface SearchHit {
  kind: "company" | "unit" | "party";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Yksi hakukenttä yhtiöille, huoneistoille ja henkilöille. "Jussilantie 3"
 * löytää huoneiston 3 yhtiöstä, jonka nimessä on Jussilantie. Ajetaan
 * käyttäjän RLS-transaktiossa, joten tulokset rajautuvat organisaatioon.
 */
export async function searchRegistry(tx: Sql, organizationId: string, query: string, limit = 30): Promise<SearchHit[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const esc = (v: string) => v.replace(/[%_\\]/g, (m) => `\\${m}`);
  const words = q.split(" ");
  // Huoneiston tunnus on viimeinen sana ("3") tai kaksi viimeistä ("A 3").
  const split = (k: number) => (words.length > k ? { company: `%${esc(words.slice(0, -k).join(" "))}%`, unit: words.slice(-k).join("") } : null);
  const one = split(1);
  const two = split(2);

  const companies = await tx.query<{ id: string; name: string; business_id: string; city: string | null }>(
    `select id, name, business_id, city from er_housing_companies
      where organization_id = $1 and (name ilike $2 or business_id ilike $2 or street_address ilike $2)
      order by name limit $3`,
    [organizationId, like, limit],
  );

  const units = await tx.query<{ id: string; unit_label: string; company_id: string; company_name: string }>(
    `select g.id, g.unit_label, g.company_id, c.name as company_name
       from er_share_groups g join er_housing_companies c on c.id = g.company_id
      where c.organization_id = $1 and g.removed_on is null
        and (($2::text is not null and c.name ilike $2 and (replace(g.unit_label, ' ', '') ilike $3 or replace(g.unit_label, ' ', '') ilike '%' || $3))
          or ($4::text is not null and c.name ilike $4 and replace(g.unit_label, ' ', '') ilike $5))
      order by c.name, length(g.unit_label), g.unit_label limit $6`,
    [organizationId, one?.company ?? null, one?.unit ?? null, two?.company ?? null, two?.unit ?? null, limit],
  );

  const parties = await tx.query<{ id: string; display_name: string; email: string | null; unit_id: string | null; unit_label: string | null; company_id: string | null; company_name: string | null }>(
    `select p.id, p.display_name, p.email, g.id as unit_id, g.unit_label, c.id as company_id, c.name as company_name
       from er_parties p
       left join lateral (
         select share_group_id from er_ownerships o where o.party_id = p.id and (o.ends_on is null or o.ends_on >= current_date)
         union all
         select share_group_id from er_residencies r where r.party_id = p.id and (r.ends_on is null or r.ends_on >= current_date)
         limit 1) rel on true
       left join er_share_groups g on g.id = rel.share_group_id
       left join er_housing_companies c on c.id = g.company_id
      where p.organization_id = $1 and (p.display_name ilike $2 or p.email ilike $2 or p.phone ilike $2)
      order by p.display_name limit $3`,
    [organizationId, like, limit],
  );

  return [
    ...companies.map((c) => ({ kind: "company" as const, id: c.id, title: c.name, subtitle: [c.business_id, c.city].filter(Boolean).join(" · "), href: `/taloyhtiot/${c.id}` })),
    ...units.map((u) => ({ kind: "unit" as const, id: u.id, title: `${u.company_name}, huoneisto ${u.unit_label}`, subtitle: "Huoneisto", href: `/taloyhtiot/${u.company_id}/huoneistot/${u.id}` })),
    ...parties.map((p) => ({
      kind: "party" as const,
      id: p.id,
      title: p.display_name,
      subtitle: p.company_name ? `${p.company_name}, ${p.unit_label}` : (p.email ?? "Ei huoneistoa"),
      href: p.unit_id ? `/taloyhtiot/${p.company_id}/huoneistot/${p.unit_id}` : "/taloyhtiot",
    })),
  ];
}
