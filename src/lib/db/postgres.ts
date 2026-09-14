import pg from "pg";
import type { Database, Sql } from "./types";

/**
 * Tuotantokanta (Supabase). Yhteys Supabasen session pooleriin käyttäjällä
 * `postgres`, joka saa vaihtaa roolia transaktion sisällä. Sama malli kuin
 * PGlitessä, joten RLS-säännöt käyttäytyvät samoin kuin testeissä.
 */
export function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: false } });

  async function run<T>(claims: Record<string, unknown>, role: string, fn: (tx: Sql) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await client.query(`set local role ${role === "service_role" ? "service_role" : "authenticated"}`);
      const tx: Sql = {
        async query<R>(text: string, params: unknown[] = []) {
          const res = await client.query(text, params);
          return res.rows as R[];
        },
      };
      const result = await fn(tx);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    asUser: (sub, fn) => run({ sub, role: "authenticated" }, "authenticated", fn),
    asService: (fn) => run({ role: "service_role" }, "service_role", fn),
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}
