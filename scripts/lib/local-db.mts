import path from "node:path";
import { createPgliteDatabase } from "../../src/lib/db/pglite.ts";
import { migrateLocal } from "../../src/lib/db/migrate.ts";

/** Skriptien paikallinen kanta (sama kuin kehityspalvelimella). Palvelin ei saa olla käynnissä. */
export async function openLocalDb() {
  const db = await createPgliteDatabase(path.join(process.cwd(), ".data", "pglite"));
  const ran = await migrateLocal(db);
  if (ran.length) console.log(`Migraatiot ajettu: ${ran.join(", ")}`);
  return db;
}
