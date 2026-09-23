import { openLocalDb } from "../scripts/lib/local-db.mts";
const db = await openLocalDb();
await db.asService(async (tx) => {
  console.log(await tx.query("select id, name, business_id from er_organizations order by name"));
  console.log(await tx.query("select id, organization_id, name from er_housing_companies where name ilike '%torpat%'"));
});
await db.close();
