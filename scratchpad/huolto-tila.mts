import { openLocalDb } from "../scripts/lib/local-db.mts";
const db = await openLocalDb();
const C = "08a1270b-5576-4271-846c-813efd3bbd60";
await db.asService(async (tx) => {
  const [c] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [C]);
  console.log("palveluntuottajat:", await tx.query("select id, name, email, phone, trades from er_service_providers where organization_id = $1", [c.organization_id]));
  console.log("yhtiön palvelut:", await tx.query("select service, default_for_requests from er_company_services where company_id = $1", [C]));
  console.log("huoltopyynnöt:", await tx.query("select number, title, status from er_service_requests where company_id = $1 order by number", [C]));
  console.log("julkinen lomake:", await tx.query("select count(*)::text as n from er_access_links where subject_table = 'er_housing_companies' and subject_id = $1", [C]).catch(() => "ei taulua"));
});
await db.close();
