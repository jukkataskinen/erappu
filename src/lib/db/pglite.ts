import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import type { Database, Sql } from "./types";

/**
 * Paikallinen PGlite-kanta kehitykseen ja testeihin.
 *
 * `dataDir` undefined = muistikanta (testit). PGlite ajaa yhden yhteyden,
 * joten transaktiot jonoutuvat; kehityskäytössä se riittää.
 */
export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  if (dataDir) {
    const { mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    await mkdir(path.dirname(dataDir), { recursive: true });
  }
  const pg = await PGlite.create({ dataDir, extensions: { btree_gist } });

  const wrap = (tx: { query: PGlite["query"] }): Sql => ({
    async query<T>(text: string, params: unknown[] = []) {
      const res = await tx.query<T>(text, params as never[]);
      return res.rows;
    },
  });

  return {
    async asUser(sub, fn) {
      return pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub, role: "authenticated" }),
        ]);
        await tx.exec("set local role authenticated");
        return fn(wrap(tx));
      });
    },
    async asService(fn) {
      return pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ role: "service_role" }),
        ]);
        await tx.exec("set local role service_role");
        return fn(wrap(tx));
      });
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
}
