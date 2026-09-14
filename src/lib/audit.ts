import type { Sql } from "@/lib/db";

/**
 * Tapahtumaloki. Ei henkilötunnisteita `details`-kenttään: vain tunnisteet
 * (uuid) ja tilamuutokset. Kirjoitetaan samassa transaktiossa kuin muutos,
 * jotta loki ja data eivät voi erota toisistaan.
 */
export async function audit(
  tx: Sql,
  entry: { organizationId: string; userId: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await tx.query(
    "insert into er_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1,$2,$3,$4,$5,$6)",
    [entry.organizationId, entry.userId, entry.action, entry.entity, entry.entityId ?? null, JSON.stringify(entry.details ?? {})],
  );
}
