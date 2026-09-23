import { PGlite } from "@electric-sql/pglite";
try {
  const db = new PGlite("./.data/pglite");
  await db.waitReady;
  const r = await db.query("select count(*)::int as n from er_housing_companies");
  console.log("OK", r.rows);
  await db.close();
} catch (e) {
  console.log("VIRHE:", e.message?.slice(0, 200));
}
