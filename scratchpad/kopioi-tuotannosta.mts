import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { openLocalDb } from "../scripts/lib/local-db.mts";

/**
 * Kopioi yhden taloyhtiön tiedot tuotannosta paikalliseen kantaan, jotta
 * portaalin näkymää voi katsoa ajantasaisella datalla ennen esittelyä.
 *
 * Vain luku tuotannosta (PostgREST, service-avain .env.production.local:sta) ja
 * kirjoitus paikalliseen PGliteen. Tuotantoon ei kirjoiteta mitään.
 * Aja dev-palvelin pysäytettynä:  npx tsx scratchpad/kopioi-tuotannosta.mts torpat
 */
const hakusana = process.argv[2] ?? "torpat";

const env = readFileSync("C:/Users/JukkaTaskinen/Claude-cowork/PROJECTS/erappu/.env.production.local", "utf8");
const pick = (k: string) => env.split(/\r?\n/).filter((l) => l.startsWith(`${k}=`)).pop()?.slice(k.length + 1).replace(/^"|"$/g, "").trim() ?? "";
const URL_ = pick("SUPABASE_URL");
const KEY = pick("SUPABASE_SECRET_KEY");
if (!URL_ || !KEY) throw new Error("Tuotannon asetukset puuttuvat");

async function prod<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`${URL_}/rest/v1/${query}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${query}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json() as Promise<T[]>;
}

/** Yhtiökohtaiset taulut riippuvuusjärjestyksessä. */
const TABLES = [
  "er_buildings", "er_properties", "er_share_groups", "er_share_ranges", "er_ownerships", "er_residencies",
  "er_board_memberships", "er_charge_bases", "er_loans", "er_loan_shares", "er_maintenance_works", "er_maintenance_needs",
  "er_documents", "er_announcements", "er_meetings", "er_meeting_items", "er_meeting_attendees", "er_tasks",
  "er_rescue_plans", "er_responsibility_exceptions", "er_water_meters", "er_water_advances", "er_service_requests",
  "er_contracts", "er_bookable_resources", "er_consumption_readings",
];

const db = await openLocalDb();
await db.asService(async (tx) => {
  const generated = new Map<string, Set<string>>();
  for (const row of await tx.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (is_generated = 'ALWAYS' or identity_generation is not null)`,
  )) {
    if (!generated.has(row.table_name)) generated.set(row.table_name, new Set());
    generated.get(row.table_name)!.add(row.column_name);
  }
  const existingTables = new Set(
    (await tx.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).map((r) => r.table_name),
  );

  const [company] = await prod<{ id: string; name: string; organization_id: string }>(
    `er_housing_companies?select=*&name=ilike.*${encodeURIComponent(hakusana)}*`,
  );
  if (!company) throw new Error("Yhtiötä ei löytynyt tuotannosta");
  console.log(`Kopioidaan: ${company.name}`);

  // Organisaation tunnus on paikallisessa kannassa eri kuin tuotannossa: käytetään
  // paikallista Adeptan organisaatiota (ei demo-organisaatiota).
  const [localOrgRow] = await tx.query<{ id: string }>(
    "select id from er_organizations where business_id is distinct from '0000001-9' order by created_at limit 1",
  );
  const localOrg = localOrgRow?.id;
  if (!localOrg) throw new Error("Paikallista organisaatiota ei löytynyt");
  // Sama yhtiö voi olla paikallisesti Access-tuonnista eri tunnuksella: poistetaan se,
  // jotta esikatselussa on vain tuotannon versio.
  const vanhat = await tx.query<{ id: string }>("select id from er_housing_companies where name = $1 and id <> $2", [company.name, company.id]);
  for (const v of vanhat) {
    await tx.query("delete from er_housing_companies where id = $1", [v.id]);
    console.log(`  poistettiin paikallinen kaksoiskappale ${v.id}`);
  }

  const upsert = async (table: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0 || !existingTables.has(table)) return 0;
    const skip = generated.get(table) ?? new Set<string>();
    for (const row of rows) {
      if (localOrg && "organization_id" in row) row.organization_id = localOrg;
      // Käyttäjäviittaukset eivät päde paikallisesti.
      for (const key of ["created_by", "updated_by", "uploaded_by", "approved_by", "published_by", "manager_user_id", "assignee_user_id", "submitted_by_user_id", "created_by_user_id", "participant_user_id", "user_id", "entered_by", "closed_by", "cancelled_by", "imported_by"]) {
        if (key in row) row[key] = null;
      }
      const cols = Object.keys(row).filter((c) => !skip.has(c) && row[c] !== undefined);
      const values = cols.map((c) => {
        const v = row[c];
        // Taulukot menevät sellaisenaan (text[]), jsonb-oliot merkkijonona.
        if (v !== null && typeof v === "object" && !Array.isArray(v)) return JSON.stringify(v);
        return v;
      });
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
      await tx.query(
        `insert into ${table} (${cols.join(", ")}) values (${placeholders.join(", ")})
         on conflict (id) do update set ${updates.join(", ")}`,
        values,
      );
    }
    return rows.length;
  };

  await upsert("er_housing_companies", [company]);

  // Osapuolet: vain ne, jotka liittyvät tähän yhtiöön.
  const [owners, residents, board] = await Promise.all([
    prod<{ party_id: string }>(`er_ownerships?select=party_id,share_group_id!inner(company_id)&share_group_id.company_id=eq.${company.id}`).catch(() => []),
    prod<{ party_id: string }>(`er_residencies?select=party_id&share_group_id=in.(select)`).catch(() => []),
    prod<{ party_id: string }>(`er_board_memberships?select=party_id&company_id=eq.${company.id}`),
  ]);
  const groups = await prod<{ id: string }>(`er_share_groups?select=id&company_id=eq.${company.id}`);
  const groupIds = groups.map((g) => g.id);
  const ownerRows = groupIds.length ? await prod<{ party_id: string }>(`er_ownerships?select=party_id&share_group_id=in.(${groupIds.join(",")})`) : [];
  const residentRows = groupIds.length ? await prod<{ party_id: string }>(`er_residencies?select=party_id&share_group_id=in.(${groupIds.join(",")})`) : [];
  const partyIds = [...new Set([...ownerRows, ...residentRows, ...board, ...owners, ...residents].map((r) => r.party_id).filter(Boolean))];
  if (partyIds.length) {
    const parties = await prod(`er_parties?select=*&id=in.(${partyIds.join(",")})`);
    console.log(`  osapuolet: ${await upsert("er_parties", parties)}`);
  }

  for (const table of TABLES) {
    if (!existingTables.has(table)) continue;
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await prod(`${table}?select=*&company_id=eq.${company.id}`);
    } catch (err) {
      console.log(`  ${table}: ohitettiin (${(err as Error).message.slice(0, 60)})`);
      continue;
    }
    const n = await upsert(table, rows);
    if (n) console.log(`  ${table}: ${n}`);
  }

  // Osakeryhmän kautta kytketyt taulut (ei omaa company_id:tä).
  if (groupIds.length) {
    for (const t of ["er_ownerships", "er_residencies", "er_water_readings"]) {
      if (!existingTables.has(t)) continue;
      const rows = await prod(`${t}?select=*&share_group_id=in.(${groupIds.join(",")})`).catch(() => []);
      const n = await upsert(t, rows);
      if (n) console.log(`  ${t} (osakeryhmä): ${n}`);
    }
  }
  const loans = await prod<{ id: string }>(`er_loans?select=id&company_id=eq.${company.id}`).catch(() => []);
  if (loans.length) {
    const rows = await prod(`er_loan_shares?select=*&loan_id=in.(${loans.map((l) => l.id).join(",")})`).catch(() => []);
    const n = await upsert("er_loan_shares", rows);
    if (n) console.log(`  er_loan_shares (laina): ${n}`);
  }

  // Kokousten asiat ja osallistujat ovat kokouksen kautta, ei company_id:n.
  const meetings = await prod<{ id: string }>(`er_meetings?select=id&company_id=eq.${company.id}`);
  for (const m of meetings) {
    for (const t of ["er_meeting_items", "er_meeting_attendees", "er_meeting_item_attachments"]) {
      if (!existingTables.has(t)) continue;
      const rows = await prod(`${t}?select=*&meeting_id=eq.${m.id}`).catch(() => []);
      const n = await upsert(t, rows);
      if (n) console.log(`  ${t} (kokous): ${n}`);
    }
  }

  // Asiakirjatiedostot paikalliseen varastoon, jotta lataus toimii.
  const docs = await prod<{ storage_path: string; file_name: string }>(`er_documents?select=storage_path,file_name&company_id=eq.${company.id}`);
  let files = 0;
  for (const d of docs) {
    const res = await fetch(`${URL_}/storage/v1/object/documents/${encodeURI(d.storage_path)}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!res.ok) continue;
    const full = path.join(process.cwd(), ".data", "files", d.storage_path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(await res.arrayBuffer()));
    files++;
  }
  console.log(`  tiedostot: ${files}/${docs.length}`);
});

await db.close();
