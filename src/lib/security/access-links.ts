import "server-only";
import type { Sql } from "@/lib/db";
import { randomToken, sha256Hex } from "./crypto";

/**
 * Kirjautumattomat linkit: palveluntuottajan tehtävä, julkinen
 * huoltopyyntölomake, todistustilaus ja kutsu. Kantaan tallennetaan vain
 * tokenin tiiviste, joten kantavedoksesta ei saa toimivia linkkejä.
 */
export type LinkPurpose = "provider_task" | "public_request_form" | "certificate_order" | "invite" | "provider_marketplace";

export async function createAccessLink(
  tx: Sql,
  opts: { organizationId: string; purpose: LinkPurpose; subjectTable: string; subjectId: string; expiresInDays?: number | null; createdBy?: string | null },
): Promise<string> {
  const token = randomToken();
  await tx.query(
    `insert into er_access_links (organization_id, purpose, token_hash, subject_table, subject_id, expires_at, created_by)
     values ($1,$2,$3,$4,$5, case when $6::int is null then null else now() + make_interval(days => $6::int) end, $7)`,
    [opts.organizationId, opts.purpose, sha256Hex(token), opts.subjectTable, opts.subjectId, opts.expiresInDays ?? null, opts.createdBy ?? null],
  );
  return token;
}

export interface ResolvedLink {
  id: string;
  organizationId: string;
  subjectTable: string;
  subjectId: string;
}

/** Palauttaa linkin, jos se on voimassa ja oikeaan tarkoitukseen. Aja palvelun roolilla. */
export async function resolveAccessLink(tx: Sql, token: string, purpose: LinkPurpose): Promise<ResolvedLink | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await tx.query<{ id: string; organization_id: string; subject_table: string; subject_id: string }>(
    `update er_access_links set last_used_at = now()
      where token_hash = $1 and purpose = $2 and revoked_at is null and (expires_at is null or expires_at > now())
      returning id, organization_id, subject_table, subject_id`,
    [sha256Hex(token), purpose],
  );
  return row ? { id: row.id, organizationId: row.organization_id, subjectTable: row.subject_table, subjectId: row.subject_id } : null;
}

export async function revokeAccessLinks(tx: Sql, subjectTable: string, subjectId: string, purpose: LinkPurpose): Promise<void> {
  await tx.query("update er_access_links set revoked_at = now() where subject_table = $1 and subject_id = $2 and purpose = $3 and revoked_at is null", [
    subjectTable,
    subjectId,
    purpose,
  ]);
}
