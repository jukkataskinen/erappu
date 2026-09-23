import { openLocalDb } from "../scripts/lib/local-db.mts";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "../src/lib/registry/portal-access.ts";

/**
 * Paikallinen portaalin esikatselu: luo kehityskirjautumisen tunnukset yhtiön
 * hallituksen jäsenille ja yhdelle osakkaalle, jotta portaalin näkymän voi
 * katsoa oikealla datalla ennen kuin kutsuja lähetetään.
 *
 * Vain paikallinen kanta (.data/pglite). Tuotantoon ei kosketa.
 * Aja dev-palvelin pysäytettynä: node --experimental-strip-types tai tsx.
 */
const db = await openLocalDb();
const hakusana = process.argv[2] ?? "torpat";

await db.asService(async (tx) => {
  const [company] = await tx.query<{ id: string; name: string; organization_id: string }>(
    "select id, name, organization_id from er_housing_companies where name ilike $1 limit 1",
    [`%${hakusana}%`],
  );
  if (!company) throw new Error(`Yhtiötä ei löytynyt haulla ${hakusana}`);
  console.log(`Yhtiö: ${company.name}`);

  const people = await tx.query<{ party_id: string; display_name: string; role: string; user_id: string | null }>(
    `select p.id as party_id, p.display_name, 'hallitus: ' || b.role as role, p.user_id
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and (b.ends_on is null or b.ends_on >= current_date)
      union all
     select p.id, p.display_name, 'osakas ' || g.unit_label, p.user_id
       from er_ownerships o join er_share_groups g on g.id = o.share_group_id join er_parties p on p.id = o.party_id
      where g.company_id = $1 and o.ends_on is null
      order by 3`,
    [company.id],
  );

  const seen = new Set<string>();
  for (const person of people) {
    if (seen.has(person.party_id)) continue;
    seen.add(person.party_id);
    let userId = person.user_id;
    if (!userId) {
      const sub = `dev|${person.display_name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
      const email = `${sub.replace("dev|", "")}@demo.invalid`;
      const [existing] = await tx.query<{ id: string }>("select id from er_users where auth_sub = $1", [sub]);
      userId =
        existing?.id ??
        (await tx.query<{ id: string }>("insert into er_users (auth_sub, email, full_name) values ($1,$2,$3) returning id", [sub, email, person.display_name]))[0].id;
      await tx.query("update er_parties set user_id = $2 where id = $1", [person.party_id, userId]);
    }
    console.log(`  ${person.display_name} (${person.role})`);
  }

  await syncPortalAccessForBoard(tx, company.id);
  const groups = await tx.query<{ id: string }>("select id from er_share_groups where company_id = $1", [company.id]);
  for (const g of groups) await syncPortalAccessForGroup(tx, g.id);

  const access = await tx.query<{ role: string; n: string }>(
    "select role, count(*)::text as n from er_portal_access where organization_id = $1 and (share_group_id in (select id from er_share_groups where company_id = $2) or company_id = $2) group by role",
    [company.organization_id, company.id],
  );
  console.log("Portaalioikeudet:", access.map((a) => `${a.role} ${a.n}`).join(", ") || "ei yhtään");
});

await db.close();
