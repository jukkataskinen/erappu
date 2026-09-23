import { openLocalDb } from "../scripts/lib/local-db.mts";

/** Paikallinen demo: palveluntuottaja ja yhtiön oletushuolto, jotta tilauskulun voi näyttää. */
const db = await openLocalDb();
await db.asService(async (tx) => {
  const [c] = await tx.query<{ id: string; organization_id: string; name: string }>(
    "select id, organization_id, name from er_housing_companies where name ilike '%torpat%' limit 1",
  );
  const [existing] = await tx.query<{ id: string }>("select id from er_service_providers where organization_id = $1 and name = 'Toivakan Kiinteistöhuolto Oy'", [c.organization_id]);
  const provider = existing ?? (await tx.query<{ id: string }>(
    `insert into er_service_providers (organization_id, name, business_id, email, phone, emergency_phone, trades)
     values ($1,'Toivakan Kiinteistöhuolto Oy','3000000-1','huolto@demo.invalid','040 000 0001','040 000 0002','{kiinteistöhuolto,lvi,sähkö}') returning id`,
    [c.organization_id],
  ))[0];
  const [linked] = await tx.query("select 1 from er_company_services where company_id = $1 and provider_id = $2", [c.id, provider.id]);
  if (!linked) {
    await tx.query(
      "insert into er_company_services (organization_id, company_id, provider_id, service, default_for_requests) values ($1,$2,$3,'kiinteistöhuolto',true)",
      [c.organization_id, c.id, provider.id],
    );
  }
  console.log(`${c.name}: palveluntuottaja ja oletuspalvelu kunnossa`);
});
await db.close();
