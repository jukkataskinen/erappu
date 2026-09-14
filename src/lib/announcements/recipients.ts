import type { Sql } from "@/lib/db";

/**
 * Tiedotteen vastaanottajat rekisteristä: osakkaat (er_ownerships), asukkaat
 * (er_residencies) ja hallitus (er_board_memberships). Sama henkilö voi olla
 * kaikkia kolmea, ja pariskunnalla voi olla yhteinen osoite, joten viesti
 * lähtee kerran osoitetta kohden.
 */

export interface AudienceRow {
  party_id: string;
  role: "owner" | "resident" | "board";
  email: string | null;
  user_id: string | null;
}

export interface EmailRecipient {
  email: string;
  partyId: string;
  roles: string[];
}

export interface RecipientSummary {
  /** Eri henkilöt (osapuolet) kohderyhmässä. */
  partyCount: number;
  /** Yksi rivi sähköpostiosoitetta kohden. */
  emailRecipients: EmailRecipient[];
  /** Henkilöt, joilla ei ole kelvollista sähköpostiosoitetta. */
  withoutEmailCount: number;
  /** Portaalitunnukselliset henkilöt (tavoitettavissa portaalissa). */
  portalUserCount: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string | null | undefined): string | null {
  const e = (value ?? "").trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function buildRecipients(rows: AudienceRow[]): RecipientSummary {
  const parties = new Map<string, { email: string | null; userId: string | null; roles: Set<string> }>();
  for (const r of rows) {
    const p = parties.get(r.party_id) ?? { email: normalizeEmail(r.email), userId: r.user_id, roles: new Set<string>() };
    p.roles.add(r.role);
    parties.set(r.party_id, p);
  }

  const byEmail = new Map<string, EmailRecipient>();
  const users = new Set<string>();
  let withoutEmailCount = 0;
  for (const [partyId, p] of parties) {
    if (p.userId) users.add(p.userId);
    if (!p.email) {
      withoutEmailCount++;
      continue;
    }
    const existing = byEmail.get(p.email);
    if (existing) {
      for (const role of p.roles) if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      byEmail.set(p.email, { email: p.email, partyId, roles: [...p.roles] });
    }
  }
  return { partyCount: parties.size, emailRecipients: [...byEmail.values()], withoutEmailCount, portalUserCount: users.size };
}

export async function queryAudience(
  tx: Sql,
  target: { companyId: string; audienceRoles: string[]; buildingIds: string[] | null },
): Promise<AudienceRow[]> {
  const buildings = target.buildingIds && target.buildingIds.length > 0 ? target.buildingIds : null;
  return tx.query<AudienceRow>(
    `with aud as (
        select o.party_id, 'owner'::text as role
          from er_ownerships o join er_share_groups g on g.id = o.share_group_id
         where 'owner' = any($2::text[]) and g.company_id = $1 and g.removed_on is null
           and (o.starts_on is null or o.starts_on <= current_date) and (o.ends_on is null or o.ends_on >= current_date)
           and ($3::uuid[] is null or g.building_id = any($3::uuid[]))
        union all
        select r.party_id, 'resident'
          from er_residencies r join er_share_groups g on g.id = r.share_group_id
         where 'resident' = any($2::text[]) and g.company_id = $1 and g.removed_on is null
           and (r.starts_on is null or r.starts_on <= current_date) and (r.ends_on is null or r.ends_on >= current_date)
           and ($3::uuid[] is null or g.building_id = any($3::uuid[]))
        union all
        -- Hallitus on koko yhtiön elin, joten rakennusrajaus ei koske sitä.
        select b.party_id, 'board'
          from er_board_memberships b
         where 'board' = any($2::text[]) and b.company_id = $1
           and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
      )
      select a.party_id, a.role, p.email, p.user_id
        from aud a join er_parties p on p.id = a.party_id
       order by a.party_id, a.role`,
    [target.companyId, target.audienceRoles, buildings],
  );
}

export async function resolveRecipients(
  tx: Sql,
  target: { companyId: string; audienceRoles: string[]; buildingIds: string[] | null },
): Promise<RecipientSummary> {
  return buildRecipients(await queryAudience(tx, target));
}
