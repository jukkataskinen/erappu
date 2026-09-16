import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db";
import type { Responsibility } from "./content";
import type { ExceptionBasis, ResponsibilityException } from "./merge";

export interface ExceptionRow extends ResponsibilityException {
  id: string;
  updated_at: string;
  updated_by_name: string | null;
}

/** Yhtiön poikkeukset. RLS rajaa: henkilökunta oman organisaation, portaali oman yhtiön. */
export async function listExceptions(tx: Sql, companyId: string): Promise<ExceptionRow[]> {
  return tx.query<ExceptionRow>(
    `select e.id, e.item_key, e.responsibility, e.basis, e.note, e.decided_on::text as decided_on,
            e.updated_at::text as updated_at, u.full_name as updated_by_name
       from er_responsibility_exceptions e
       left join er_users u on u.id = e.updated_by
      where e.company_id = $1
      order by e.item_key`,
    [companyId],
  );
}

export interface SaveExceptionInput {
  companyId: string;
  userId: string;
  itemKey: string;
  responsibility: Responsibility;
  basis: ExceptionBasis;
  note: string;
  decidedOn: string | null;
}

/** Lisää tai korvaa kohteen poikkeuksen. Yhdellä kohteella on yhtiössä yksi poikkeus. */
export async function saveException(tx: Sql, input: SaveExceptionInput): Promise<{ id: string; created: boolean }> {
  const [row] = await tx.query<{ id: string; organization_id: string; created: boolean }>(
    `insert into er_responsibility_exceptions (organization_id, company_id, item_key, responsibility, basis, note, decided_on, created_by, updated_by)
     select c.organization_id, c.id, $2, $3, $4, $5, $6, $7, $7 from er_housing_companies c where c.id = $1
     on conflict (company_id, item_key) do update
        set responsibility = excluded.responsibility, basis = excluded.basis, note = excluded.note,
            decided_on = excluded.decided_on, updated_by = excluded.updated_by
     returning id, organization_id, (xmax = 0) as created`,
    [input.companyId, input.itemKey, input.responsibility, input.basis, input.note, input.decidedOn, input.userId],
  );
  if (!row) throw new Error("Yhtiötä ei löytynyt.");
  await audit(tx, {
    organizationId: row.organization_id,
    userId: input.userId,
    action: row.created ? "create" : "update",
    entity: "responsibility_exception",
    entityId: row.id,
    details: { company_id: input.companyId, item_key: input.itemKey, responsibility: input.responsibility, basis: input.basis },
  });
  return { id: row.id, created: row.created };
}

export async function deleteException(tx: Sql, input: { companyId: string; userId: string; itemKey: string }): Promise<boolean> {
  const [row] = await tx.query<{ id: string; organization_id: string }>(
    "delete from er_responsibility_exceptions where company_id = $1 and item_key = $2 returning id, organization_id",
    [input.companyId, input.itemKey],
  );
  if (!row) return false;
  await audit(tx, {
    organizationId: row.organization_id,
    userId: input.userId,
    action: "delete",
    entity: "responsibility_exception",
    entityId: row.id,
    details: { company_id: input.companyId, item_key: input.itemKey },
  });
  return true;
}
