import "server-only";
import path from "node:path";
import type { Database } from "./types";
import { databaseUrl, dbDriver } from "@/lib/config/deploy-env";

export type { Database, Sql } from "./types";

/**
 * Sovelluksen jaettu kantayhteys. Next.js:n kehityspalvelin lataa moduuleja
 * uudelleen, joten instanssi pidetään globalThisissä.
 */
const globalForDb = globalThis as unknown as { __erappuDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!globalForDb.__erappuDb) {
    globalForDb.__erappuDb = (async () => {
      if (dbDriver() === "postgres") {
        const { createPostgresDatabase } = await import("./postgres");
        const url = databaseUrl();
        if (!url) throw new Error("DATABASE_URL tai POSTGRES_URL puuttuu");
        return createPostgresDatabase(url);
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
