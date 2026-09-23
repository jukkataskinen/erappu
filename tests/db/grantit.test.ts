import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "../helpers/db";
import type { Database } from "@/lib/db/types";

/**
 * Jokaisella taululla on oltava grantit rooleille, joilla sovellus ajaa:
 * käyttäjän pyynnöt roolilla `authenticated` ja palvelinajot roolilla
 * `service_role`. Supabase lopettaa 30.10.2026 automaattiset grantit uusille
 * public-skeeman tauluille, joten unohtunut grant näkyisi vasta tuotannossa.
 * Tämä testi pysäyttää sen jo täällä.
 */
let db: Database;

beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => db.close());

describe("taulujen grantit", () => {
  it("jokaisella er-taululla on oikeudet authenticated- tai service_role-roolille", async () => {
    const rows = await db.asService((tx) =>
      tx.query<{ table_name: string }>(
        `select t.table_name
           from information_schema.tables t
          where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name like 'er\_%'
            and not exists (
              select 1 from information_schema.role_table_grants g
               where g.table_schema = 'public' and g.table_name = t.table_name
                 and g.grantee in ('authenticated', 'service_role'))
          order by t.table_name`,
      ),
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
