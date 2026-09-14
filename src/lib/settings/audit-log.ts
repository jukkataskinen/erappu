import type { Sql } from "@/lib/db";

/**
 * Tapahtumalokin näkymä. Käyttäjän RLS-transaktiossa (audit_read: owner ja
 * manager). `details`-kenttää ei haeta lainkaan: näkymään riittää kuka, mitä,
 * mihin ja milloin, eikä mahdollinen henkilötieto päädy selaimeen.
 */

export interface AuditFilter {
  userId?: string | null;
  action?: string | null;
  entity?: string | null;
}

export interface AuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_label: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
}

export const AUDIT_LIMIT = 200;

export async function listAuditLog(tx: Sql, organizationId: string, filter: AuditFilter = {}): Promise<AuditRow[]> {
  return tx.query<AuditRow>(
    `select a.id::text, a.created_at, a.user_id, a.action, a.entity, a.entity_id,
            coalesce(u.full_name, u.email) as user_label
       from er_audit_log a
       left join er_users u on u.id = a.user_id
      where a.organization_id = $1
        and ($2::uuid is null or a.user_id = $2::uuid)
        and ($3::text is null or a.action = $3)
        and ($4::text is null or a.entity = $4)
      order by a.created_at desc, a.id desc
      limit ${AUDIT_LIMIT}`,
    [organizationId, filter.userId ?? null, filter.action ?? null, filter.entity ?? null],
  );
}

/** Suodatinvalikoiden arvot. */
export async function auditFacets(tx: Sql, organizationId: string): Promise<{ actions: string[]; entities: string[] }> {
  const [row] = await tx.query<{ actions: string[] | null; entities: string[] | null }>(
    `select array_agg(distinct action order by action) as actions, array_agg(distinct entity order by entity) as entities
       from er_audit_log where organization_id = $1`,
    [organizationId],
  );
  return { actions: row?.actions ?? [], entities: row?.entities ?? [] };
}
