import type { Sql } from "@/lib/db";
import type { EsinettiClient } from "@/lib/esinetti";

/**
 * Taloyhtiön vastine eSinetissä (0111).
 *
 * eSinetti tallentaa kierrokset yhtiölle. Ilman tätä kaikki kierrokset
 * menisivät organisaation oletusyhtiölle. Yhtiö luodaan ensimmäisellä
 * kerralla ja tunniste muistetaan, joten myöhemmät kierrokset eivät kutsu
 * rajapintaa turhaan.
 *
 * `POST /companies` on eSinetissä upsert y-tunnuksella, joten kutsun voi
 * toistaa: kahta yhtiötä ei synny, vaikka tallennus tänne epäonnistuisi.
 * Jos yhtiön luonti ei onnistu, allekirjoitusta ei jätetä tekemättä —
 * kierros menee oletusyhtiölle ja tunniste haetaan seuraavalla kerralla.
 */
export async function ensureEsinettiCompany(
  run: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>,
  client: EsinettiClient,
  companyId: string,
): Promise<string | undefined> {
  const company = await run(async (tx) => {
    const [row] = await tx.query<{ name: string; business_id: string | null; esinetti_company_id: string | null }>(
      "select name, business_id, esinetti_company_id from er_housing_companies where id = $1",
      [companyId],
    );
    return row ?? null;
  });
  if (!company) return undefined;
  if (company.esinetti_company_id) return company.esinetti_company_id;

  try {
    const created = await client.upsertCompany({
      name: company.name,
      businessId: company.business_id ?? undefined,
      externalRef: `erappu:company:${companyId}`,
    });
    await run((tx) => tx.query("update er_housing_companies set esinetti_company_id = $2 where id = $1", [companyId, created.id]));
    return created.id;
  } catch (err) {
    // Arkiston järjestys ei ole syy estää allekirjoitusta.
    console.error(`[esinetti] yhtiön luonti epäonnistui: ${err instanceof Error ? err.name : "virhe"}`);
    return undefined;
  }
}
