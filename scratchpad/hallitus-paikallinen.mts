import { openLocalDb } from "../scripts/lib/local-db.mts";
import { syncPortalAccessForBoard } from "../src/lib/registry/portal-access.ts";

/** Paikallinen esikatselu: hallitus rekisteriin ja tunnukset kehityskirjautumiseen. */
const db = await openLocalDb();
const BOARD: [string, "chair" | "member"][] = [
  ["Jouttijärvi Olavi", "chair"],
  ["Heinonen Martti", "member"],
  ["Eila Hokkanen", "member"],
];

await db.asService(async (tx) => {
  const [c] = await tx.query<{ id: string; organization_id: string; name: string }>(
    "select id, organization_id, name from er_housing_companies where name ilike '%torpat%' limit 1",
  );
  for (const [name, role] of BOARD) {
    let [p] = await tx.query<{ id: string; user_id: string | null }>(
      "select id, user_id from er_parties where organization_id = $1 and display_name = $2 limit 1",
      [c.organization_id, name],
    );
    if (!p) {
      const parts = name.split(" ");
      [p] = await tx.query<{ id: string; user_id: string | null }>(
        "insert into er_parties (organization_id, first_names, last_name) values ($1,$2,$3) returning id, user_id",
        [c.organization_id, parts.slice(1).join(" ") || parts[0], parts[0]],
      );
      console.log(`  luotu osapuoli ${name}`);
    }
    if (!p.user_id) {
      const sub = `dev|${name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
      const [u] = await tx.query<{ id: string }>(
        "insert into er_users (auth_sub, email, full_name) values ($1,$2,$3) on conflict (auth_sub) do update set full_name = excluded.full_name returning id",
        [sub, `${sub.replace("dev|", "")}@demo.invalid`, name],
      );
      await tx.query("update er_parties set user_id = $2 where id = $1", [p.id, u.id]);
    }
    const [exists] = await tx.query("select 1 from er_board_memberships where company_id = $1 and party_id = $2 and ends_on is null", [c.id, p.id]);
    if (!exists) {
      await tx.query(
        "insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,$4,'2026-07-01')",
        [c.organization_id, c.id, p.id, role],
      );
    }
    console.log(`  ${name}: ${role}`);
  }
  await syncPortalAccessForBoard(tx, c.id);
  console.log("portaalirivit:", await tx.query("select role, count(*)::text as n from er_portal_access where company_id = $1 group by role", [c.id]));
});
await db.close();
