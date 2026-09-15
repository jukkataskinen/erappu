import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { supabaseHeaders } from "../config/deploy-env";

/**
 * Yhden organisaation datan siirto kannasta toiseen (paikallinen PGlite →
 * tuotannon Supabase). Ohje: scripts/deploy/migrate-org-to-production.mts.
 *
 * Taulut, sarakkeet, tyypit ja FK-riippuvuudet luetaan katalogista eikä
 * kovakoodata, jotta uusi migraatio ei jää siirrosta pois huomaamatta. Arvot
 * luetaan tekstinä ja kirjoitetaan kohteen tyypin castilla: numeric, jsonb,
 * taulukot ja aikaleimat säilyvät täsmälleen ilman JS-tyyppimuunnoksia.
 *
 * Tuloste ja palautettava yhteenveto eivät sisällä henkilötietoja: vain
 * taulujen ja sarakkeiden nimiä, määriä ja yhtiöiden nimiä.
 */

export interface RawSql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

type Row = (string | null)[];

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  generated: boolean;
  identity: boolean;
  hasDefault: boolean;
}

interface ForeignKey {
  name: string;
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

interface Catalog {
  columns: Map<string, ColumnInfo[]>;
  foreignKeys: ForeignKey[];
  primaryKeys: Map<string, string[]>;
}

export const ORGANIZATIONS_TABLE = "er_organizations";
export const USERS_TABLE = "er_users";

/** Taulut, joita ei siirretä, vaikka niissä on organisaation rivejä. */
export const DEFAULT_EXCLUDED_TABLES: Record<string, string> = {
  er_organizations: "Tuotannon organisaatiorivi säilyy (bootstrap-owner); paikallinen id kartoitetaan siihen.",
  er_users: "Käyttäjät syntyvät tuotannossa Auth0-kirjautumisella; viittaukset kartoitetaan tuotannon pääkäyttäjään tai tyhjiksi.",
  er_org_members: "Henkilökunnan jäsenyydet tehdään tuotannossa kutsuilla; paikalliset jäsenet ovat kehityskäyttäjiä.",
  er_invitations: "Kutsujen tokenit on muodostettu paikallisesti; kutsut lähetetään tuotannossa uudelleen.",
  er_portal_access: "Portaalioikeudet sidotaan käyttäjiin, jotka kirjautuvat tuotantoon myöhemmin.",
  er_announcement_reads: "Lukukuittaukset ovat paikallisten käyttäjien.",
  er_audit_log: "Kehitysympäristön tapahtumaloki; tuotannon loki alkaa siirrosta.",
  er_outbound_messages: "Viestijono: siirto lähettäisi paikallisesti jonoon jääneet viestit tuotannosta.",
  er_access_links: "Linkkien tiivisteet on laskettu paikallisella salaisuudella; linkit luodaan tuotannossa uudelleen.",
  er_public_request_forms: "Lomakelinkin token on salattu paikallisella avaimella; linkki luodaan tuotannossa uudelleen.",
  er_rate_limits: "Kutsurajoittimen tilapäinen tila.",
  er_webhook_events: "eSinetti-jäljitelmän webhook-tapahtumat.",
  er_htj_requests: "HTJ-jäljitelmän hakuloki.",
  er_party_identifiers: "Henkilötunnukset ja syntymäajat: ei siirretä (HETU_PEPPER ja salausavain ovat ympäristökohtaisia).",
};

/** Henkilötunnusmaiset sarakkeet jätetään pois myös siirrettävistä tauluista. */
const PERSONAL_ID_COLUMN = /(^|_)(hetu|ssn|personal_id|henkilotunnus|birth_date)(_|$)/i;

/** Käyttäjäviittaukset, jotka tyhjennetään aina (osakkaat eivät ole vielä kirjautuneet tuotantoon). */
const ALWAYS_NULL_USER_REFS = new Set(["er_parties.user_id"]);

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const key = (values: (string | null)[]) => values.join(String.fromCharCode(1));

async function readCatalog(db: RawSql): Promise<Catalog> {
  const cols = await db.query<{ table_name: string; column_name: string; type: string; not_null: boolean; generated: boolean; identity: boolean; has_default: boolean }>(
    `select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type,
            a.attnotnull as not_null, a.attgenerated <> '' as generated, a.attidentity <> '' as identity, a.atthasdef as has_default
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`,
  );
  const columns = new Map<string, ColumnInfo[]>();
  for (const c of cols) {
    const list = columns.get(c.table_name) ?? [];
    list.push({ name: c.column_name, type: c.type, notNull: c.not_null, generated: c.generated, identity: c.identity, hasDefault: c.has_default });
    columns.set(c.table_name, list);
  }
  const cons = await db.query<{ name: string; contype: string; table_name: string; ref_table: string | null; cols: string; ref_cols: string | null }>(
    `select con.conname as name, con.contype::text as contype, src.relname as table_name, dst.relname as ref_table,
            array_to_string(array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
                                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o), ',') as cols,
            array_to_string(array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
                                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o), ',') as ref_cols
       from pg_constraint con
       join pg_class src on src.oid = con.conrelid
       join pg_namespace n on n.oid = src.relnamespace
       left join pg_class dst on dst.oid = con.confrelid
      where n.nspname = 'public' and con.contype in ('f', 'p')
      order by src.relname, con.conname`,
  );
  const foreignKeys: ForeignKey[] = [];
  const primaryKeys = new Map<string, string[]>();
  for (const c of cons) {
    if (c.contype === "p") primaryKeys.set(c.table_name, c.cols.split(","));
    else foreignKeys.push({ name: c.name, table: c.table_name, columns: c.cols.split(","), refTable: c.ref_table ?? "", refColumns: (c.ref_cols ?? "").split(",") });
  }
  return { columns, foreignKeys, primaryKeys };
}

export interface PlannedTable {
  name: string;
  columns: { name: string; type: string }[];
  rows: Row[];
  /** Sarake, joka rajaa rivit organisaatioon (organization_id tai FK er_organizationsiin). */
  orgColumn: string | null;
  /** Linkittävät FK:t, jos taulussa ei ole organisaatiosaraketta. */
  linkedVia: ForeignKey[];
  identity: boolean;
  selfRefs: ForeignKey[];
}

export interface PlannedFile {
  table: string;
  id: string;
  companyId: string | null;
  sourcePath: string;
  targetPath: string;
  mimeType: string;
  sizeBytes: number | null;
  sha256: string | null;
}

export interface UserRefStat {
  column: string;
  toOwner: number;
  toNull: number;
  forcedOwner: number;
}

export interface MigrationPlan {
  sourceOrgId: string;
  targetOrgId: string;
  organizationName: string;
  sourceUserFound: boolean;
  targetOwner: { id: string; authSub: string };
  tables: PlannedTable[];
  excludedTables: { table: string; reason: string; sourceRows: number }[];
  excludedColumns: { table: string; column: string; reason: string; nonNullRows: number }[];
  userRefs: UserRefStat[];
  files: PlannedFile[];
  warnings: string[];
  /** Organisaation ulkopuoliset taulut (ei organisaatiosaraketta eikä linkkiä), vain raportointiin. */
  unrelatedTables: string[];
}

export interface PlanOptions {
  businessId: string;
  /** Paikallinen käyttäjä, jonka viittaukset kartoitetaan tuotannon pääkäyttäjään. */
  sourceUserEmail: string;
  sourceUserAuthSub?: string;
  excludeTables?: Record<string, string>;
}

export class MigrationError extends Error {}

export async function buildMigrationPlan(source: RawSql, target: RawSql, opts: PlanOptions): Promise<MigrationPlan> {
  const excluded = { ...DEFAULT_EXCLUDED_TABLES, ...(opts.excludeTables ?? {}) };
  const warnings: string[] = [];

  const srcOrgs = await source.query<{ id: string; name: string }>(`select id::text, name from ${ORGANIZATIONS_TABLE} where business_id = $1`, [opts.businessId]);
  if (srcOrgs.length !== 1) throw new MigrationError(`Lähdekannassa on ${srcOrgs.length} organisaatiota y-tunnuksella ${opts.businessId} (odotettiin 1).`);
  const tgtOrgs = await target.query<{ id: string; name: string }>(`select id::text, name from ${ORGANIZATIONS_TABLE} where business_id = $1`, [opts.businessId]);
  if (tgtOrgs.length !== 1) throw new MigrationError(`Kohdekannassa on ${tgtOrgs.length} organisaatiota y-tunnuksella ${opts.businessId} (odotettiin 1). Aja ensin scripts/deploy/bootstrap-owner.mts.`);
  const sourceOrgId = srcOrgs[0].id;
  const targetOrgId = tgtOrgs[0].id;

  const owners = await target.query<{ id: string; auth_sub: string }>(
    `select u.id::text, u.auth_sub from er_org_members m join ${USERS_TABLE} u on u.id = m.user_id where m.organization_id = $1 and m.role = 'owner' order by u.created_at`,
    [targetOrgId],
  );
  if (owners.length !== 1) throw new MigrationError(`Kohdeorganisaatiolla on ${owners.length} pääkäyttäjää (odotettiin 1). Pääkäyttäjän on hyväksyttävä kutsu ennen siirtoa.`);
  const targetOwner = { id: owners[0].id, authSub: owners[0].auth_sub };

  const srcUsers = await source.query<{ id: string }>(
    `select id::text from ${USERS_TABLE} where lower(email) = lower($1) or auth_sub = $2`,
    [opts.sourceUserEmail, opts.sourceUserAuthSub ?? null],
  );
  if (srcUsers.length > 1) throw new MigrationError("Lähdekannasta löytyi useampi käyttäjä annetulla sähköpostilla tai tunnisteella.");
  const sourceUserId = srcUsers[0]?.id ?? null;
  if (!sourceUserId) warnings.push("Paikallista pääkäyttäjää ei löytynyt; kaikki käyttäjäviittaukset käsitellään muina käyttäjinä.");

  const [srcCat, tgtCat] = await Promise.all([readCatalog(source), readCatalog(target)]);

  // Organisaatioon sidotut taulut: organisaatiosarake tai FK-ketju sellaiseen tauluun.
  const orgColumnOf = new Map<string, string>();
  for (const [table, cols] of srcCat.columns) {
    if (table === ORGANIZATIONS_TABLE) continue;
    const fkOrg = srcCat.foreignKeys.find((f) => f.table === table && f.refTable === ORGANIZATIONS_TABLE && f.columns.length === 1);
    if (fkOrg) orgColumnOf.set(table, fkOrg.columns[0]);
    else if (cols.some((c) => c.name === "organization_id")) orgColumnOf.set(table, "organization_id");
  }
  const related = new Set(orgColumnOf.keys());
  for (let changed = true; changed; ) {
    changed = false;
    for (const fk of srcCat.foreignKeys) {
      if (!related.has(fk.table) && fk.table !== fk.refTable && related.has(fk.refTable) && fk.table !== USERS_TABLE && fk.table !== ORGANIZATIONS_TABLE) {
        related.add(fk.table);
        changed = true;
      }
    }
  }
  const unrelatedTables = [...srcCat.columns.keys()].filter((t) => !related.has(t) && !(t in excluded)).sort();

  const excludedTables: MigrationPlan["excludedTables"] = [];
  for (const [table, reason] of Object.entries(excluded).sort(([a], [b]) => a.localeCompare(b))) {
    if (!srcCat.columns.has(table)) continue;
    const orgCol = orgColumnOf.get(table);
    const [{ n }] = orgCol
      ? await source.query<{ n: number }>(`select count(*)::int as n from ${ident(table)} where ${ident(orgCol)}::text = $1`, [sourceOrgId])
      : table === ORGANIZATIONS_TABLE
        ? [{ n: 1 }]
        : await source.query<{ n: number }>(`select count(*)::int as n from ${ident(table)}`);
    excludedTables.push({ table, reason, sourceRows: n });
  }

  const included = [...related].filter((t) => !(t in excluded));
  for (const t of included) {
    if (!tgtCat.columns.has(t)) throw new MigrationError(`Taulu ${t} puuttuu kohdekannasta. Aja migraatiot tuotantoon ennen siirtoa.`);
  }
  const includedSet = new Set(included);

  // Taulujärjestys FK-riippuvuuksista (Kahn), itseviittaukset erikseen.
  const deps = new Map<string, Set<string>>(included.map((t) => [t, new Set<string>()]));
  for (const fk of srcCat.foreignKeys) {
    if (includedSet.has(fk.table) && includedSet.has(fk.refTable) && fk.table !== fk.refTable) deps.get(fk.table)!.add(fk.refTable);
  }
  const order: string[] = [];
  const remaining = new Set(included);
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...deps.get(t)!].every((d) => !remaining.has(d))).sort();
    if (!ready.length) {
      const cyclic = [...remaining].sort();
      warnings.push(`FK-sykli tauluissa ${cyclic.join(", ")}; järjestys aakkosittain (vaatii triggerien ohituksen).`);
      order.push(...cyclic);
      break;
    }
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }

  const excludedColumns: MigrationPlan["excludedColumns"] = [];
  const userRefStats = new Map<string, UserRefStat>();
  const tables: PlannedTable[] = [];
  const includedRows = new Map<string, { columns: string[]; rows: Row[] }>();
  const files: PlannedFile[] = [];
  const otherUserIdsInText = new Map<string, number>();

  const allSourceUserIds = new Set((await source.query<{ id: string }>(`select id::text from ${USERS_TABLE}`)).map((r) => r.id));

  for (const table of order) {
    const srcCols = srcCat.columns.get(table)!;
    const tgtCols = new Map(tgtCat.columns.get(table)!.map((c) => [c.name, c]));
    const orgColumn = orgColumnOf.get(table) ?? null;

    const readCols = srcCols.filter((c) => !c.generated).map((c) => c.name);
    const where = orgColumn ? `where ${ident(orgColumn)}::text = $1` : "";
    const raw = await source.query<Record<string, string | null>>(
      `select ${readCols.map((c, i) => `${ident(c)}::text as c${i}`).join(", ")} from ${ident(table)} ${where}`,
      orgColumn ? [sourceOrgId] : [],
    );
    let rows: Row[] = raw.map((r) => readCols.map((_, i) => r[`c${i}`]));

    const linkedVia = orgColumn ? [] : srcCat.foreignKeys.filter((f) => f.table === table && f.refTable !== table && includedSet.has(f.refTable));
    if (!orgColumn) {
      // Rivi kuuluu organisaatioon, jos jokin sen FK-viittauksista osuu siirrettävään riviin.
      const matchers = linkedVia.map((fk) => {
        const parent = includedRows.get(fk.refTable)!;
        const refIdx = fk.refColumns.map((c) => parent.columns.indexOf(c));
        const set = new Set(parent.rows.map((r) => key(refIdx.map((i) => r[i]))));
        const idx = fk.columns.map((c) => readCols.indexOf(c));
        return (row: Row) => idx.every((i) => row[i] !== null) && set.has(key(idx.map((i) => row[i])));
      });
      rows = rows.filter((row) => matchers.some((m) => m(row)));
    }

    // Kirjoitettavat sarakkeet: lähteen ja kohteen yhteiset, ei generoituja eikä henkilötunnuksia.
    const writeCols: { name: string; type: string; srcIdx: number }[] = [];
    for (const [i, name] of readCols.entries()) {
      const nonNull = rows.filter((r) => r[i] !== null).length;
      const tgt = tgtCols.get(name);
      if (PERSONAL_ID_COLUMN.test(name)) {
        if (tgt && tgt.notNull && !tgt.hasDefault) throw new MigrationError(`${table}.${name} on henkilötunnusmainen ja pakollinen kohteessa; lisää taulu poissulkulistaan.`);
        excludedColumns.push({ table, column: name, reason: "henkilötunnus tai syntymäaika", nonNullRows: nonNull });
        continue;
      }
      if (!tgt) {
        excludedColumns.push({ table, column: name, reason: "sarake puuttuu kohdekannasta", nonNullRows: nonNull });
        if (nonNull) warnings.push(`${table}.${name}: sarake puuttuu kohteesta, ${nonNull} riviltä jää arvo siirtämättä.`);
        continue;
      }
      if (tgt.generated) continue;
      writeCols.push({ name, type: tgt.type, srcIdx: i });
    }
    for (const c of tgtCols.values()) {
      if (c.notNull && !c.hasDefault && !c.generated && !c.identity && !readCols.includes(c.name)) {
        throw new MigrationError(`${table}.${c.name} on kohteessa pakollinen, mutta lähteessä sitä ei ole. Lähdekannan migraatiot ovat jäljessä.`);
      }
    }

    // FK:t siirtämättömiin tauluihin (käyttäjät erikseen).
    const fksOut = srcCat.foreignKeys.filter((f) => f.table === table && f.refTable !== table && !includedSet.has(f.refTable) && f.refTable !== ORGANIZATIONS_TABLE);
    const userCols = new Set(fksOut.filter((f) => f.refTable === USERS_TABLE && f.columns.length === 1).map((f) => f.columns[0]));
    const nullCols = new Map<string, string>();
    for (const fk of fksOut) {
      if (fk.refTable === USERS_TABLE && fk.columns.length === 1) continue;
      for (const c of fk.columns) nullCols.set(c, fk.refTable);
    }

    const outRows: Row[] = [];
    for (const row of rows) {
      const out: Row = [];
      for (const col of writeCols) {
        let v = row[col.srcIdx];
        const colInfo = tgtCols.get(col.name)!;
        if (v !== null && userCols.has(col.name)) {
          const statKey = `${table}.${col.name}`;
          const stat = userRefStats.get(statKey) ?? { column: statKey, toOwner: 0, toNull: 0, forcedOwner: 0 };
          userRefStats.set(statKey, stat);
          if (ALWAYS_NULL_USER_REFS.has(statKey)) {
            v = null;
            stat.toNull++;
          } else if (v === sourceUserId) {
            v = targetOwner.id;
            stat.toOwner++;
          } else if (!colInfo.notNull) {
            v = null;
            stat.toNull++;
          } else {
            v = targetOwner.id;
            stat.forcedOwner++;
          }
        } else if (v !== null && nullCols.has(col.name)) {
          if (colInfo.notNull) throw new MigrationError(`${table}.${col.name} viittaa siirtämättömään tauluun ${nullCols.get(col.name)} eikä salli tyhjää.`);
          v = null;
          const w = `${table}.${col.name}: viittaus siirtämättömään tauluun ${nullCols.get(col.name)} tyhjennetty`;
          otherUserIdsInText.set(w, (otherUserIdsInText.get(w) ?? 0) + 1);
        } else if (v !== null) {
          if (v.includes(sourceOrgId)) v = v.split(sourceOrgId).join(targetOrgId);
          if (col.name === "storage_path") v = asciiStoragePath(v);
          if (sourceUserId && v.includes(sourceUserId)) v = v.split(sourceUserId).join(targetOwner.id);
          if (v.length >= 36 && /[0-9a-f]{8}-/.test(v)) {
            for (const uid of allSourceUserIds) {
              if (uid !== sourceUserId && v.includes(uid)) {
                const w = `${table}.${col.name}: sisältää muun paikallisen käyttäjän tunnisteen (jätetty ennalleen)`;
                otherUserIdsInText.set(w, (otherUserIdsInText.get(w) ?? 0) + 1);
              }
            }
          }
        }
        out.push(v);
      }
      outRows.push(out);
    }

    const selfRefs = srcCat.foreignKeys.filter((f) => f.table === table && f.refTable === table);
    const planned: PlannedTable = {
      name: table,
      columns: writeCols.map((c) => ({ name: c.name, type: c.type })),
      rows: sortSelfReferencing(outRows, writeCols.map((c) => c.name), selfRefs),
      orgColumn,
      linkedVia,
      identity: writeCols.some((c) => tgtCols.get(c.name)!.identity),
      selfRefs,
    };
    tables.push(planned);
    includedRows.set(table, { columns: readCols, rows });

    const spIdx = readCols.indexOf("storage_path");
    if (spIdx !== -1) {
      const idIdx = readCols.indexOf("id");
      const at = (r: Row, c: string) => (readCols.indexOf(c) === -1 ? null : r[readCols.indexOf(c)]);
      for (const r of rows) {
        const sp = r[spIdx];
        if (!sp) continue;
        const size = at(r, "size_bytes");
        files.push({
          table,
          id: idIdx === -1 ? "" : (r[idIdx] ?? ""),
          companyId: at(r, "company_id"),
          sourcePath: sp,
          targetPath: asciiStoragePath(sp.split(sourceOrgId).join(targetOrgId)),
          mimeType: at(r, "mime_type") ?? "application/octet-stream",
          sizeBytes: size === null ? null : Number(size),
          sha256: at(r, "sha256"),
        });
      }
    }
  }

  for (const [w, n] of otherUserIdsInText) warnings.push(`${w} (${n} riviä).`);

  const rounds = tables.find((t) => t.name === "er_signing_rounds");
  const roundIdx = rounds?.columns.findIndex((c) => c.name === "esinetti_round_id") ?? -1;
  const withRound = rounds && roundIdx !== -1 ? rounds.rows.filter((r) => r[roundIdx] !== null).length : 0;
  if (withRound) {
    warnings.push(`er_signing_rounds: ${withRound} allekirjoituskierrosta on tehty paikallisesti (ESINETTI_MODE=mock); niiden eSinetti-tunnisteita ei ole tuotannon eSinetissä.`);
  }
  const settings = await source.query<{ n: number }>(`select count(*)::int as n from ${ORGANIZATIONS_TABLE}, jsonb_object_keys(settings) where id::text = $1`, [sourceOrgId]).catch(() => [{ n: 0 }]);
  if (settings[0]?.n) warnings.push(`Paikallisen organisaation asetuksissa on ${settings[0].n} avainta, joita ei siirretä (organisaatiorivi säilyy tuotannossa). Tarkista asetukset sovelluksesta.`);
  for (const s of userRefStats.values()) {
    if (s.forcedOwner) warnings.push(`${s.column}: ${s.forcedOwner} muun käyttäjän viittausta kartoitettiin pääkäyttäjään, koska sarake ei salli tyhjää.`);
  }

  return {
    sourceOrgId,
    targetOrgId,
    organizationName: tgtOrgs[0].name,
    sourceUserFound: Boolean(sourceUserId),
    targetOwner,
    tables,
    excludedTables,
    excludedColumns,
    userRefs: [...userRefStats.values()].sort((a, b) => a.column.localeCompare(b.column)),
    files,
    warnings,
    unrelatedTables,
  };
}

/** Itseviittaavat rivit järjestykseen vanhempi ensin, jotta FK kelpaa myös ilman triggerien ohitusta. */
function sortSelfReferencing(rows: Row[], columns: string[], selfRefs: ForeignKey[]): Row[] {
  const refs = selfRefs.filter((f) => f.columns.length === 1 && f.refColumns.length === 1 && columns.includes(f.columns[0]) && columns.includes(f.refColumns[0]));
  if (!refs.length) return rows;
  const done = new Set<string>();
  const out: Row[] = [];
  let pending = rows;
  while (pending.length) {
    const next: Row[] = [];
    for (const r of pending) {
      const ok = refs.every((f) => {
        const v = r[columns.indexOf(f.columns[0])];
        return v === null || done.has(`${f.name}:${v}`) || !rows.some((p) => p[columns.indexOf(f.refColumns[0])] === v);
      });
      if (ok) {
        out.push(r);
        for (const f of refs) done.add(`${f.name}:${r[columns.indexOf(f.refColumns[0])]}`);
      } else next.push(r);
    }
    if (next.length === pending.length) return [...out, ...next];
    pending = next;
  }
  return out;
}

/* -------------------------------------------------------------------------
   Kirjoitus kohteeseen
   ------------------------------------------------------------------------- */

export type TriggerMode = "replica" | "disable";

export interface ApplyOptions {
  commit: boolean;
  replaceExisting: boolean;
  /** Testejä varten; oletus kokeilee ensin replica-tilaa. */
  triggerMode?: TriggerMode;
}

export interface ApplyResult {
  committed: boolean;
  triggerMode: TriggerMode;
  existingRows: { table: string; rows: number }[];
  deletedRows: { table: string; rows: number }[];
  insertedRows: { table: string; expected: number; actual: number }[];
  fkViolations: { constraint: string; table: string; rows: number }[];
  rls: { table: string; expected: number; visible: number | null; error?: string }[];
  errors: string[];
}

export class ExistingDataError extends MigrationError {
  constructor(readonly existing: { table: string; rows: number }[]) {
    super(
      `Tuotannossa on jo organisaation dataa (${existing.map((e) => `${e.table} ${e.rows}`).join(", ")}). ` +
        "Siirto kieltäytyy, jottei data kahdennu. Lipulla --korvaa-org-data nykyinen organisaation data poistetaan ensin.",
    );
  }
}

class Rollback extends Error {}

/** SQL-ehto, joka rajaa taulun rivit kohdeorganisaatioon ($1), myös FK-ketjun kautta. */
function ownedPredicate(plan: MigrationPlan, table: string, alias: string, depth = 0): string {
  const t = plan.tables.find((x) => x.name === table)!;
  if (t.orgColumn) return `${alias}.${ident(t.orgColumn)} = $1::uuid`;
  if (depth > 10) return "false";
  const parts = t.linkedVia.map((fk) => {
    const p = `p${depth}`;
    const join = fk.columns.map((c, i) => `${p}.${ident(fk.refColumns[i])} = ${alias}.${ident(c)}`).join(" and ");
    return `exists (select 1 from ${ident(fk.refTable)} ${p} where ${join} and ${ownedPredicate(plan, fk.refTable, p, depth + 1)})`;
  });
  return parts.length ? `(${parts.join(" or ")})` : "false";
}

/** Kohdeorganisaation nykyiset rivit siirrettävissä tauluissa. */
export async function existingOrgRows(target: RawSql, plan: MigrationPlan): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = [];
  for (const t of plan.tables) {
    const [{ n }] = await target.query<{ n: number }>(`select count(*)::int as n from ${ident(t.name)} x where ${ownedPredicate(plan, t.name, "x")}`, [plan.targetOrgId]);
    if (n) out.push({ table: t.name, rows: n });
  }
  return out;
}

export async function applyMigrationPlan(target: RawSql, plan: MigrationPlan, opts: ApplyOptions): Promise<ApplyResult> {
  const result: ApplyResult = { committed: false, triggerMode: opts.triggerMode ?? "replica", existingRows: [], deletedRows: [], insertedRows: [], fkViolations: [], rls: [], errors: [] };
  const org = plan.targetOrgId;

  await target.query("begin");
  try {
    result.existingRows = await existingOrgRows(target, plan);
    if (result.existingRows.length && !opts.replaceExisting) throw new ExistingDataError(result.existingRows);

    if (!opts.triggerMode) {
      await target.query("savepoint replica_probe");
      try {
        await target.query("set local session_replication_role = replica");
        await target.query("release savepoint replica_probe");
        result.triggerMode = "replica";
      } catch {
        await target.query("rollback to savepoint replica_probe");
        result.triggerMode = "disable";
      }
    } else if (opts.triggerMode === "replica") {
      await target.query("set local session_replication_role = replica");
    }
    // Ilman replica-tilaa käyttäjän triggerit ohitetaan taulukohtaisesti: muuten esim. huoltopyynnön
    // luontitrigger kirjoittaisi tapahtuman, joka on jo siirrettävissä riveissä. FK:t pysyvät voimassa.
    if (result.triggerMode === "disable") {
      for (const t of plan.tables) await target.query(`alter table ${ident(t.name)} disable trigger user`);
    }

    if (opts.replaceExisting && result.existingRows.length) {
      for (const t of [...plan.tables].reverse()) {
        const rows = await target.query<{ n: number }>(
          `with d as (delete from ${ident(t.name)} x where ${ownedPredicate(plan, t.name, "x")} returning 1) select count(*)::int as n from d`,
          [org],
        );
        if (rows[0].n) result.deletedRows.push({ table: t.name, rows: rows[0].n });
      }
    }

    for (const t of plan.tables) {
      if (!t.rows.length || !t.columns.length) continue;
      const perRow = t.columns.length;
      const chunk = Math.max(1, Math.floor(20000 / perRow));
      for (let i = 0; i < t.rows.length; i += chunk) {
        const part = t.rows.slice(i, i + chunk);
        const params: unknown[] = [];
        const values = part.map((row) => `(${row.map((v, j) => {
          params.push(v);
          return `$${params.length}::text::${t.columns[j].type}`;
        }).join(", ")})`);
        await target.query(
          `insert into ${ident(t.name)} (${t.columns.map((c) => ident(c.name)).join(", ")}) ${t.identity ? "overriding system value " : ""}values ${values.join(", ")}`,
          params,
        );
      }
    }

    if (result.triggerMode === "disable") {
      for (const t of plan.tables) await target.query(`alter table ${ident(t.name)} enable trigger user`);
    } else {
      await target.query("set local session_replication_role = origin");
    }

    for (const t of plan.tables) {
      const [{ n }] = await target.query<{ n: number }>(`select count(*)::int as n from ${ident(t.name)} x where ${ownedPredicate(plan, t.name, "x")}`, [org]);
      result.insertedRows.push({ table: t.name, expected: t.rows.length, actual: n });
      if (n !== t.rows.length) result.errors.push(`${t.name}: odotettiin ${t.rows.length} riviä, kohteessa ${n}.`);
    }

    // FK:t tarkistetaan erikseen, koska replica-tilassa kanta ei tarkista niitä lisäyksessä.
    const tgtCat = await readCatalog(target);
    const checks = tgtCat.foreignKeys.map((fk) => {
      const notNull = fk.columns.map((c) => `c.${ident(c)} is not null`).join(" and ");
      const join = fk.columns.map((c, i) => `p.${ident(fk.refColumns[i])} = c.${ident(c)}`).join(" and ");
      return `select ${sqlText(fk.name)} as name, ${sqlText(fk.table)} as table_name, count(*)::int as n from ${ident(fk.table)} c where ${notNull} and not exists (select 1 from ${ident(fk.refTable)} p where ${join})`;
    });
    if (checks.length) {
      const rows = await target.query<{ name: string; table_name: string; n: number }>(checks.join(" union all "));
      for (const r of rows) if (r.n) result.fkViolations.push({ constraint: r.name, table: r.table_name, rows: r.n });
    }
    for (const v of result.fkViolations) result.errors.push(`FK ${v.constraint} (${v.table}): ${v.rows} riviä ilman viitattua riviä.`);

    // RLS: näkeekö tuotannon pääkäyttäjä rivit omalla roolillaan.
    for (const t of plan.tables) {
      if (!t.rows.length) continue;
      await target.query("savepoint rls_check");
      try {
        await target.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: plan.targetOwner.authSub, role: "authenticated" })]);
        await target.query("set local role authenticated");
        const [{ n }] = await target.query<{ n: number }>(`select count(*)::int as n from ${ident(t.name)} x where ${ownedPredicate(plan, t.name, "x")}`, [org]);
        result.rls.push({ table: t.name, expected: t.rows.length, visible: n });
        await target.query("release savepoint rls_check");
      } catch (e) {
        await target.query("rollback to savepoint rls_check");
        result.rls.push({ table: t.name, expected: t.rows.length, visible: null, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      }
      await target.query("reset role");
      await target.query("select set_config('request.jwt.claims', '', true)");
    }
    const companies = result.rls.find((r) => r.table === "er_housing_companies");
    if (companies && companies.visible !== companies.expected) {
      result.errors.push(`RLS: pääkäyttäjä näkee ${companies.visible ?? 0} / ${companies.expected} yhtiötä.`);
    }

    if (!opts.commit || result.errors.length) throw new Rollback();
    await target.query("commit");
    result.committed = true;
    return result;
  } catch (e) {
    await target.query("rollback").catch(() => undefined);
    if (e instanceof Rollback) {
      if (opts.commit && result.errors.length) throw new MigrationError(`Siirto peruttu tarkistusvirheiden takia:\n  ${result.errors.join("\n  ")}`);
      return result;
    }
    throw e;
  }
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/* -------------------------------------------------------------------------
   Tiedostot
   ------------------------------------------------------------------------- */

export interface FileCheck {
  total: number;
  totalBytes: number;
  missing: PlannedFile[];
  sizeMismatch: PlannedFile[];
  hashMismatch: PlannedFile[];
  pathMismatch: PlannedFile[];
  /** Organisaation kansiossa levyllä, mutta ei yhdelläkään siirrettävällä rivillä. */
  unreferenced: { count: number; bytes: number };
}

/**
 * Supabase Storage hylkää avaimet, joissa on muita kuin ASCII-merkkejä
 * ("InvalidKey"). Vanhoissa paikallisissa riveissä tiedostonimi voi olla
 * esim. `Yhtiöjärjestys.pdf`. Sama muunnos kuin `storeFile`in avaimessa;
 * näyttönimi (`file_name`) säilyy ennallaan.
 */
export function asciiStoragePath(storagePath: string): string {
  return storagePath
    .split("/")
    .map((part) => part.normalize("NFKD").replace(/[^\w.-]+/g, "").replace(/\.{2,}/g, ".") || "tiedosto")
    .join("/");
}

function pathMatches(f: PlannedFile, sourceOrgId: string): boolean {
  const parts = f.sourcePath.split("/");
  return parts.length === 4 && !f.sourcePath.includes("..") && parts[0] === sourceOrgId && parts[1] === (f.companyId ?? "_") && parts.every(Boolean);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

export async function checkFiles(plan: MigrationPlan, filesRoot: string): Promise<FileCheck> {
  const check: FileCheck = { total: plan.files.length, totalBytes: 0, missing: [], sizeMismatch: [], hashMismatch: [], pathMismatch: [], unreferenced: { count: 0, bytes: 0 } };
  const referenced = new Set<string>();
  for (const f of plan.files) {
    if (!pathMatches(f, plan.sourceOrgId)) check.pathMismatch.push(f);
    if (f.sourcePath.includes("..")) {
      check.missing.push(f);
      continue;
    }
    const full = path.join(filesRoot, ...f.sourcePath.split("/"));
    referenced.add(path.resolve(full));
    try {
      const s = await stat(full);
      check.totalBytes += s.size;
      if (f.sizeBytes !== null && s.size !== f.sizeBytes) check.sizeMismatch.push(f);
      else if (f.sha256) {
        const hash = createHash("sha256").update(await readFile(full)).digest("hex");
        if (hash !== f.sha256) check.hashMismatch.push(f);
      }
    } catch {
      check.missing.push(f);
    }
  }
  for (const file of await walk(path.join(filesRoot, plan.sourceOrgId))) {
    if (referenced.has(path.resolve(file))) continue;
    check.unreferenced.count++;
    check.unreferenced.bytes += (await stat(file)).size;
  }
  return check;
}

export interface UploadOptions {
  filesRoot: string;
  supabaseUrl: string;
  secretKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}

/** x-upsert: true, jotta keskeytynyt tai toistettu siirto voidaan ajaa uudelleen. */
export async function uploadFiles(files: PlannedFile[], opts: UploadOptions): Promise<{ uploaded: number; bytes: number }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const bucket = opts.bucket ?? "documents";
  let bytes = 0;
  for (const [i, f] of files.entries()) {
    const body = await readFile(path.join(opts.filesRoot, ...f.sourcePath.split("/")));
    const res = await doFetch(`${opts.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${encodeURI(f.targetPath)}`, {
      method: "POST",
      headers: { ...supabaseHeaders(opts.secretKey), "Content-Type": f.mimeType, "x-upsert": "true" },
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MigrationError(`Tiedoston ${i + 1}/${files.length} (dokumentti ${f.id}) lataus epäonnistui (${res.status}): ${text.slice(0, 200)}`);
    }
    bytes += body.length;
    opts.onProgress?.(i + 1, files.length);
  }
  return { uploaded: files.length, bytes };
}

/* -------------------------------------------------------------------------
   Ympäristötiedosto
   ------------------------------------------------------------------------- */

/**
 * `vercel env pull` kirjoittaa salaisten muuttujien tilalle paikkamerkin
 * ("[SENSITIVE]"), ja käsin lisätty rivi voi olla tiedoston lopussa saman nimen
 * alla. Siksi jokaisesta nimestä otetaan viimeinen kelvollisen muotoinen arvo.
 */
export function readEnvValues(content: string, name: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i === -1 || line.trimStart().startsWith("#") || line.slice(0, i).trim() !== name) continue;
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (v) out.push(v);
  }
  return out;
}

const lastValid = (content: string, name: string, valid: (v: string) => boolean) => readEnvValues(content, name).filter(valid).pop();

/** Vain kelvollisen muotoiset arvot; tulos annetaan deploy-env.ts:n apureille. */
export function productionEnv(content: string): Record<string, string | undefined> {
  const pgUrl = (v: string) => /^postgres(ql)?:\/\//.test(v);
  const jwt = (v: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v);
  return {
    DATABASE_URL_DIRECT: lastValid(content, "DATABASE_URL_DIRECT", pgUrl),
    POSTGRES_URL_NON_POOLING: lastValid(content, "POSTGRES_URL_NON_POOLING", pgUrl),
    DATABASE_URL: lastValid(content, "DATABASE_URL", pgUrl),
    POSTGRES_URL: lastValid(content, "POSTGRES_URL", pgUrl),
    SUPABASE_URL: lastValid(content, "SUPABASE_URL", (v) => /^https:\/\/[^\s/]+/.test(v)),
    SUPABASE_SECRET_KEY: lastValid(content, "SUPABASE_SECRET_KEY", (v) => v.startsWith("sb_secret_")),
    SUPABASE_SERVICE_ROLE_KEY: lastValid(content, "SUPABASE_SERVICE_ROLE_KEY", (v) => jwt(v) || v.startsWith("sb_secret_")),
  };
}

/* -------------------------------------------------------------------------
   Yhteenveto (ei henkilötietoja)
   ------------------------------------------------------------------------- */

function tableObjects(plan: MigrationPlan, name: string): Record<string, string | null>[] {
  const t = plan.tables.find((x) => x.name === name);
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
}

const DOCUMENT_CATEGORIES: Record<string, string> = {
  articles: "Yhtiöjärjestys",
  financial_statement: "Tilinpäätös",
  budget: "Talousarvio",
  energy_certificate: "Energiatodistus",
  floor_plan: "Pohjapiirustus",
  minutes: "Pöytäkirja",
  meeting_notice: "Kokouskutsu",
  contract: "Sopimus",
  condition_assessment: "Kuntoarvio",
  maintenance_plan: "Kunnossapitosuunnitelma",
  maintenance_needs_report: "Kunnossapitotarveselvitys",
  manager_certificate: "Isännöitsijäntodistus",
  photo: "Kuva",
  insurance: "Vakuutus",
  other: "Muu",
};

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} Mt`;

export function summarizePlan(plan: MigrationPlan, files: FileCheck | null, apply: ApplyResult | null): string[] {
  const lines: string[] = [];
  const nonEmpty = plan.tables.filter((t) => t.rows.length);
  lines.push(`## Taulut ja rivit (${nonEmpty.length} taulua, ${plan.tables.reduce((s, t) => s + t.rows.length, 0)} riviä)`, "");
  lines.push("| Taulu | Rivit | Kohteessa | Pääkäyttäjä näkee |", "|---|---:|---:|---:|");
  for (const t of plan.tables) {
    if (!t.rows.length) continue;
    const ins = apply?.insertedRows.find((r) => r.table === t.name);
    const rls = apply?.rls.find((r) => r.table === t.name);
    lines.push(`| ${t.name} | ${t.rows.length} | ${ins ? ins.actual : "–"} | ${rls ? (rls.visible ?? `virhe`) : "–"} |`);
  }
  const empty = plan.tables.filter((t) => !t.rows.length).map((t) => t.name);
  if (empty.length) lines.push("", `Tyhjät (ei rivejä organisaatiolla): ${empty.join(", ")}`);

  const companies = tableObjects(plan, "er_housing_companies");
  if (companies.length) {
    const groups = tableObjects(plan, "er_share_groups");
    const ownerships = tableObjects(plan, "er_ownerships");
    const residencies = tableObjects(plan, "er_residencies");
    const groupCompany = new Map(groups.map((g) => [g.id, g.company_id]));
    lines.push("", `## Yhtiöt (${companies.length})`, "", "| Yhtiö | Osakeryhmät | joista asuinhuoneistoja | Osakkaat | Asumiset |", "|---|---:|---:|---:|---:|");
    for (const c of [...companies].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fi"))) {
      const g = groups.filter((x) => x.company_id === c.id);
      const owners = new Set(ownerships.filter((o) => groupCompany.get(o.share_group_id) === c.id).map((o) => o.party_id));
      const res = residencies.filter((r) => groupCompany.get(r.share_group_id) === c.id).length;
      lines.push(`| ${c.name} | ${g.length} | ${g.filter((x) => x.kind === "apartment").length} | ${owners.size} | ${res} |`);
    }
  }

  const docs = tableObjects(plan, "er_documents");
  if (docs.length) {
    const byCat = new Map<string, number>();
    for (const d of docs) byCat.set(d.category ?? "?", (byCat.get(d.category ?? "?") ?? 0) + 1);
    lines.push("", `## Dokumentit (${docs.length})`, "");
    for (const [cat, n] of [...byCat].sort((a, b) => b[1] - a[1])) lines.push(`- ${DOCUMENT_CATEGORIES[cat] ?? cat}: ${n}`);
  }

  if (files) {
    lines.push("", "## Tiedostot", "");
    lines.push(`- Siirrettäviä: ${files.total}, levyllä yhteensä ${mb(files.totalBytes)}`);
    lines.push(`- Puuttuu levyltä: ${files.missing.length}${files.missing.length ? ` (dokumentit ${files.missing.map((f) => f.id).join(", ")})` : ""}`);
    lines.push(`- Koko ei vastaa riviä: ${files.sizeMismatch.length}${files.sizeMismatch.length ? ` (${files.sizeMismatch.map((f) => f.id).join(", ")})` : ""}`);
    lines.push(`- Tiiviste ei vastaa riviä: ${files.hashMismatch.length}${files.hashMismatch.length ? ` (${files.hashMismatch.map((f) => f.id).join(", ")})` : ""}`);
    lines.push(`- storage_path ei vastaa organisaatiota/yhtiötä: ${files.pathMismatch.length}${files.pathMismatch.length ? ` (${files.pathMismatch.map((f) => f.id).join(", ")})` : ""}`);
    lines.push(`- Organisaation kansiossa ilman dokumenttiriviä (ei siirretä): ${files.unreferenced.count}, ${mb(files.unreferenced.bytes)}`);
  }

  lines.push("", "## Poisjätetyt taulut", "", "| Taulu | Organisaation rivejä lähteessä | Syy |", "|---|---:|---|");
  for (const e of plan.excludedTables) lines.push(`| ${e.table} | ${e.sourceRows} | ${e.reason} |`);
  if (plan.unrelatedTables.length) lines.push("", `Ei organisaatiodataa: ${plan.unrelatedTables.join(", ")}`);

  lines.push("", "## Poisjätetyt sarakkeet", "");
  if (!plan.excludedColumns.length) lines.push("- Ei yhtään. Henkilötunnukset ovat vain taulussa er_party_identifiers, joka jätetään kokonaan pois.");
  for (const c of plan.excludedColumns) lines.push(`- ${c.table}.${c.column}: ${c.reason} (arvo ${c.nonNullRows} rivillä)`);
  lines.push("- Generoidut sarakkeet (esim. er_parties.display_name) lasketaan kohteessa uudelleen.");

  lines.push("", "## Käyttäjäviittaukset", "", `Paikallinen pääkäyttäjä ${plan.sourceUserFound ? "löytyi" : "EI löytynyt"}; viittaukset → tuotannon pääkäyttäjä.`, "");
  lines.push("| Sarake | → pääkäyttäjä | → tyhjä | muu → pääkäyttäjä (pakollinen sarake) |", "|---|---:|---:|---:|");
  for (const u of plan.userRefs) lines.push(`| ${u.column} | ${u.toOwner} | ${u.toNull} | ${u.forcedOwner} |`);

  if (apply) {
    lines.push("", "## Tarkistukset kohteessa", "");
    lines.push(`- Triggerit: ${apply.triggerMode === "replica" ? "ohitettu session_replication_role = replica" : "ohitettu taulukohtaisesti (disable trigger user)"}`);
    if (apply.existingRows.length) lines.push(`- Kohteessa oli ennestään: ${apply.existingRows.map((r) => `${r.table} ${r.rows}`).join(", ")}`);
    if (apply.deletedRows.length) lines.push(`- Poistettu ennen siirtoa: ${apply.deletedRows.map((r) => `${r.table} ${r.rows}`).join(", ")}`);
    lines.push(`- Rivimäärät: ${apply.insertedRows.every((r) => r.actual === r.expected) ? "täsmäävät" : "EIVÄT täsmää"}`);
    lines.push(`- Viite-eheys (kaikki FK:t): ${apply.fkViolations.length ? `${apply.fkViolations.length} rikkomusta` : "kunnossa"}`);
    const rlsBad = apply.rls.filter((r) => r.visible !== r.expected);
    lines.push(`- RLS pääkäyttäjänä: ${rlsBad.length ? `poikkeamia ${rlsBad.map((r) => `${r.table} ${r.visible ?? r.error}/${r.expected}`).join(", ")}` : "kaikki rivit näkyvät"}`);
    lines.push(`- Transaktio: ${apply.committed ? "HYVÄKSYTTY (commit)" : "peruttu (rollback)"}`);
    for (const e of apply.errors) lines.push(`- VIRHE: ${e}`);
  }

  lines.push("", "## Varoitukset", "");
  if (!plan.warnings.length) lines.push("- Ei varoituksia.");
  for (const w of plan.warnings) lines.push(`- ${w}`);
  return lines;
}
