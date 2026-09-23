import { openLocalDb } from "../scripts/lib/local-db.mts";
const db = await openLocalDb();
await db.asService(async (tx) => {
  const [c] = await tx.query<{ id: string; name: string }>("select id, name from er_housing_companies where name ilike '%torpat%' limit 1");
  console.log(c.name, c.id);
  console.log(await tx.query("select b.role, b.starts_on::text, b.ends_on::text, p.display_name, p.user_id is not null as tunnus from er_board_memberships b join er_parties p on p.id = b.party_id where b.company_id = $1", [c.id]));
  console.log("portaalirivit:", await tx.query("select role, count(*)::text as n from er_portal_access where company_id = $1 group by role", [c.id]));
});
await db.close();
