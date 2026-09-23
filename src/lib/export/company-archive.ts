import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { readStoredFile } from "@/lib/storage";
import { createZip, toCsv, type ZipEntry } from "./zip";

/**
 * Yhtiön koko aineisto yhtenä zip-tiedostona (palvelusopimus 10.3: rekisteritiedot
 * koneluettavassa muodossa ja asiakirjat alkuperäisinä tiedostoina).
 *
 * Rekisteritaulut haetaan yleisesti: jokainen `er_`-alkuinen taulu, jossa on
 * sarake `company_id`, viedään omaksi CSV:kseen. Näin uusi moduuli tulee mukaan
 * ilman muutoksia tänne. Kysely ajetaan käyttäjän RLS-transaktiossa, joten
 * mukaan ei voi tulla toisen organisaation rivejä.
 *
 * Henkilötunnukset eivät tule mukaan: ne ovat taulussa `er_party_identifiers`,
 * jolla ei ole RLS-politiikkaa eikä siihen pääse käyttäjän transaktiossa.
 * Sarakkeet, joiden nimessä on token, secret, salasana tai encrypted, jätetään
 * pois varmuuden vuoksi.
 */

/** Zipin enimmäiskoko. Suurempi aineisto luovutetaan erissä. */
export const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;

const SKIP_TABLES = new Set(["er_party_identifiers", "er_public_request_forms", "er_webhook_events"]);
const SKIP_COLUMN = /token|secret|salasana|password|encrypted|storage_path/i;

interface DocFile {
  id: string;
  category: string;
  file_name: string;
  storage_path: string;
  title: string;
  size_bytes: string;
  created_at: string;
  unit_label: string | null;
}

/** Tiedostonimi, joka kelpaa Windowsissa ja Macissa. */
function safeName(name: string): string {
  return (name.normalize("NFC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "tiedosto").slice(0, 120);
}

export interface ArchiveResult {
  bytes: Buffer;
  fileName: string;
  tables: number;
  documents: number;
  skipped: string[];
}

/** Lukija injektoitavana, jotta kulku voidaan testata ilman tiedostovarastoa. */
export interface ArchiveDeps {
  read?: (storagePath: string) => Promise<Buffer>;
}

export async function buildCompanyArchive(tx: Sql, companyId: string, userId: string, deps: ArchiveDeps = {}): Promise<ArchiveResult | null> {
  const read = deps.read ?? readStoredFile;
  const [company] = await tx.query<{ id: string; organization_id: string; name: string; business_id: string | null }>(
    "select id, organization_id, name, business_id from er_housing_companies where id = $1",
    [companyId],
  );
  if (!company) return null;

  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  const today = new Date();

  // --- Rekisteritaulut ------------------------------------------------------
  const tables = await tx.query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'company_id' and table_name like 'er\\_%'
      group by table_name order by table_name`,
  );
  let tableCount = 0;
  for (const { table_name } of tables) {
    if (SKIP_TABLES.has(table_name)) continue;
    const rows = await tx.query<Record<string, unknown>>(`select * from ${table_name} where company_id = $1`, [companyId]);
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]).filter((c) => !SKIP_COLUMN.test(c));
    entries.push({
      name: `rekisteri/${table_name.replace(/^er_/, "")}.csv`,
      data: toCsv(
        columns,
        rows.map((r) => columns.map((c) => (r[c] instanceof Date ? (r[c] as Date).toISOString() : (r[c] as string | number | null)))),
      ),
      date: today,
    });
    tableCount++;
  }

  // Yhtiön oma rivi: er_housing_companies tunnistetaan id:llä, ei company_id:llä,
  // joten se ei tule yllä olevasta yleisestä hausta.
  const [row] = await tx.query<Record<string, unknown>>("select * from er_housing_companies where id = $1", [companyId]);
  if (row) {
    const columns = Object.keys(row).filter((c) => !SKIP_COLUMN.test(c));
    entries.push({ name: "rekisteri/yhtio.csv", data: toCsv(columns, [columns.map((c) => (row[c] instanceof Date ? (row[c] as Date).toISOString() : (row[c] as string | number | null)))]), date: today });
    tableCount++;
  }

  // Henkilöt erikseen: er_parties on organisaation taulu, joten se rajataan
  // tämän yhtiön kytköksiin.
  const parties = await tx.query<Record<string, unknown>>(
    `select distinct p.id, p.kind, p.first_names, p.last_name, p.company_name, p.business_id, p.email, p.phone,
            p.street_address, p.postal_code, p.city, p.country, p.electronic_notice_consent, p.accounting_customer_no
       from er_parties p
      where p.id in (select party_id from er_ownerships o join er_share_groups g on g.id = o.share_group_id where g.company_id = $1)
         or p.id in (select party_id from er_residencies r join er_share_groups g on g.id = r.share_group_id where g.company_id = $1)
         or p.id in (select party_id from er_board_memberships b where b.company_id = $1)
      order by p.last_name nulls last, p.first_names nulls last`,
    [companyId],
  );
  if (parties.length > 0) {
    const columns = Object.keys(parties[0]);
    entries.push({
      name: "rekisteri/henkilot.csv",
      data: toCsv(columns, parties.map((r) => columns.map((c) => r[c] as string | number | null))),
      date: today,
    });
    tableCount++;
  }

  // --- Asiakirjat -----------------------------------------------------------
  const docs = await tx.query<DocFile>(
    `select d.id, d.category, d.file_name, d.storage_path, d.title, d.size_bytes::text, d.created_at::text, g.unit_label
       from er_documents d left join er_share_groups g on g.id = d.share_group_id
      where d.company_id = $1 order by d.category, d.created_at`,
    [companyId],
  );
  let total = entries.reduce((sum, e) => sum + e.data.length, 0);
  let documentCount = 0;
  const manifest: (string | number | null)[][] = [];
  for (const doc of docs) {
    const folder = `dokumentit/${safeName(doc.category)}`;
    const name = `${folder}/${doc.unit_label ? `${safeName(doc.unit_label)} - ` : ""}${safeName(doc.file_name)}`;
    if (total + Number(doc.size_bytes || 0) > MAX_ARCHIVE_BYTES) {
      skipped.push(doc.file_name);
      manifest.push([doc.category, doc.title, doc.unit_label, doc.file_name, doc.size_bytes, doc.created_at, "ei mukana, arkisto täynnä"]);
      continue;
    }
    try {
      const data = await read(doc.storage_path);
      entries.push({ name, data, date: new Date(doc.created_at) });
      total += data.length;
      documentCount++;
      manifest.push([doc.category, doc.title, doc.unit_label, name, doc.size_bytes, doc.created_at, "mukana"]);
    } catch {
      skipped.push(doc.file_name);
      manifest.push([doc.category, doc.title, doc.unit_label, doc.file_name, doc.size_bytes, doc.created_at, "tiedostoa ei löytynyt"]);
    }
  }
  entries.push({
    name: "dokumentit/luettelo.csv",
    data: toCsv(["luokka", "otsikko", "huoneisto", "tiedosto", "koko_tavua", "tallennettu", "tila"], manifest),
    date: today,
  });

  // --- Lukuohje -------------------------------------------------------------
  const iso = today.toISOString().slice(0, 10);
  entries.unshift({
    name: "LUE-MINUT.txt",
    data: Buffer.from(
      [
        `${company.name}${company.business_id ? ` (${company.business_id})` : ""}`,
        `Aineisto eRapusta ${iso}`,
        "",
        "kansio rekisteri/",
        "  Yhtiön tiedot tauluittain CSV-muodossa. Erotin on puolipiste ja merkistö UTF-8,",
        "  joten tiedostot aukeavat Excelissä suomalaisilla asetuksilla.",
        "  Tiedosto henkilot.csv sisältää osakkaat, asukkaat ja hallituksen jäsenet.",
        "",
        "kansio dokumentit/",
        "  Asiakirjat alkuperäisinä tiedostoina luokittain. Tiedosto luettelo.csv kertoo,",
        "  mikä asiakirja on missäkin tiedostossa ja mitä jäi mahdollisesti pois.",
        "",
        "Henkilötunnuksia ei sisälly tähän aineistoon. Ne säilytetään erikseen salattuina,",
        "ja ne luovutetaan tarvittaessa erikseen pyynnöstä.",
        "",
        skipped.length ? `Pois jäi ${skipped.length} tiedostoa, ks. dokumentit/luettelo.csv.` : "Kaikki asiakirjat ovat mukana.",
      ].join("\n"),
      "utf8",
    ),
    date: today,
  });

  const bytes = createZip(entries);
  await audit(tx, {
    organizationId: company.organization_id,
    userId,
    action: "export",
    entity: "company",
    entityId: companyId,
    details: { taulut: tableCount, asiakirjat: documentCount, poisjaaneet: skipped.length, tavuja: bytes.length },
  });

  return {
    bytes,
    fileName: `${safeName(company.name).replace(/\s+/g, "-").toLowerCase()}-aineisto-${iso}.zip`,
    tables: tableCount,
    documents: documentCount,
    skipped,
  };
}
