import "server-only";
import path from "node:path";
import type { Database } from "./types";

export type { Database, Sql } from "./types";

/**
 * Sovelluksen jaettu kantayhteys. Next.js:n kehityspalvelin lataa moduuleja
 * uudelleen, joten instanssi pidetään globalThisissä.
 */
const globalForDb = globalThis as unknown as { __erappuDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!globalForDb.__erappuDb) {
    globalForDb.__erappuDb = (async () => {
      if (process.env.DB_DRIVER === "postgres") {
        const { createPostgresDatabase } = await import("./postgres");
        if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL puuttuu");
        return createPostgresDatabase(process.env.DATABASE_URL);
      }
      const { createPgliteDatabase } = await import("./pglite");
      const { migrateLocal } = await import("./migrate");
      const db = await createPgliteDatabase(path.join(process.cwd(), ".data", "pglite"));
      await migrateLocal(db);
      return db;
    })();
  }
  return globalForDb.__erappuDb;
}
