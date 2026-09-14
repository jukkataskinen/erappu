import "server-only";
import { cookies } from "next/headers";
import type { Sql } from "@/lib/db";
import { verifySignedValue } from "@/lib/security/crypto";

/**
 * Julkisen todistustilauslinkin näyttäminen henkilökunnalle.
 *
 * Kantaan tallennetaan vain tokenin tiiviste, joten linkki voidaan näyttää
 * vain luontihetkellä. Arvo kulkee lyhytikäisessä, allekirjoitetussa ja
 * polkuun rajatussa evästeessä eikä osoiterivillä.
 */
export const ORDER_LINK_FLASH_COOKIE = "erappu_order_link";

export function orderLinkUrl(token: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/todistustilaus/${token}`;
}

/** Juuri luotu linkki (kahden minuutin ajan), jos se kuuluu annettuun yhtiöön. */
export async function readOrderLinkFlash(): Promise<{ companyId: string; url: string } | null> {
  const value = verifySignedValue((await cookies()).get(ORDER_LINK_FLASH_COOKIE)?.value);
  if (!value) return null;
  const [companyId, token] = value.split(":");
  if (!companyId || !token) return null;
  return { companyId, url: orderLinkUrl(token) };
}

export async function activeOrderLinks(tx: Sql, companyIds: string[]): Promise<Map<string, string | null>> {
  if (companyIds.length === 0) return new Map();
  const rows = await tx.query<{ subject_id: string; expires_at: string | null }>(
    `select subject_id, max(expires_at) as expires_at from er_access_links
      where purpose = 'certificate_order' and subject_table = 'er_housing_companies' and subject_id = any($1::uuid[])
        and revoked_at is null and (expires_at is null or expires_at > now())
      group by subject_id`,
    [companyIds],
  );
  return new Map(rows.map((r) => [r.subject_id, r.expires_at]));
}
