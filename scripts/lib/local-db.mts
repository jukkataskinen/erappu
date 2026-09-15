import path from "node:path";
import { createPgliteDatabase } from "../../src/lib/db/pglite.ts";
import { migrateLocal } from "../../src/lib/db/migrate.ts";

/**
 * Skriptien paikallinen kanta (sama kuin kehityspalvelimella). Palvelin ei saa olla käynnissä.
 * `dataDir` antaa toisen hakemiston, esim. kehityskannan kopion kuivaharjoitukseen.
 */
export async function openLocalDb(dataDir?: string) {
  const db = await createPgliteDatabase(dataDir ? path.resolve(dataDir) : path.join(process.cwd(), ".data", "pglite"));
  const ran = await migrateLocal(db);
  if (ran.length) console.log(`Migraatiot ajettu: ${ran.join(", ")}`);
  return db;
}
