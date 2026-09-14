import type { Sql } from "@/lib/db";
import { listCompanies } from "@/lib/registry/queries";

/** Lomakkeen valinnat: organisaation yhtiöt ja niiden rakennukset. */
export async function announcementFormOptions(tx: Sql, organizationId: string) {
  const companies = await listCompanies(tx, organizationId);
  const buildings = await tx.query<{ id: string; company_id: string; label: string | null }>(
    "select id, company_id, label from er_buildings where organization_id = $1 order by label nulls first",
    [organizationId],
  );
  return { companies: companies.map((c) => ({ id: c.id, name: c.name })), buildings };
}
