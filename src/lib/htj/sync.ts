import type { Database, Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import type { HtjClient } from "./client";
import { withRequestLog } from "./log";
import {
  companyWarnings,
  diffRegistry,
  shareGroupChanges,
  type DiffItem,
  type LocalOwnership,
  type LocalShareGroup,
  type LocalState,
  type OwnershipSnapshot,
  type ShareGroupSnapshot,
} from "./diff";
import { HtjError, type HtjCallMeta, type HtjPurpose } from "./types";

/**
 * HTJ-synkronointi: haku, erojen tallennus ja hyväksyttyjen erojen
 * kirjoittaminen rekisteriin.
 *
 * Kaikki funktiot saavat transaktion (`Sql`). Käyttäjän toiminnoissa se on
 * RLS-transaktio, jolloin kanta tarkistaa, että hakija ja hyväksyjä ovat
 * pääkäyttäjiä tai isännöitsijöitä. Ajastettu tehtävä käyttää palvelun roolia.
 */

interface CompanyRow {
  id: string;
  organization_id: string;
  business_id: string;
  name: string;
  total_shares: number | null;
}

export interface FetchResult {
  syncId: string;
  status: "ok" | "warnings" | "error";
  diffCount: number;
  error?: string;
}

export async function loadLocalState(tx: Sql, companyId: string): Promise<LocalState> {
  const groups = await tx.query<{
    id: string; unit_label: string; kind: string; area_m2: string | null; intended_use: string | null; layout: string | null; floor: string | null;
    htj_id: string | null; ranges: { first: number; last: number }[];
  }>(
    `select g.id, g.unit_label, g.kind, g.area_m2, g.intended_use, g.layout, g.floor, g.htj_id,
            coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                        from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
       from er_share_groups g
      where g.company_id = $1 and g.removed_on is null`,
    [companyId],
  );
  const owners = await tx.query<{
    id: string; share_group_id: string; party_id: string; party_htj_id: string | null; display_name: string;
    share_numerator: number; share_denominator: number; starts_on: string | Date | null; htj_id: string | null;
  }>(
    `select o.id, o.share_group_id, o.party_id, p.htj_id as party_htj_id, p.display_name, o.share_numerator, o.share_denominator, o.starts_on, o.htj_id
       from er_ownerships o
       join er_share_groups g on g.id = o.share_group_id
       join er_parties p on p.id = o.party_id
      where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= current_date)`,
    [companyId],
  );
  return {
    shareGroups: groups.map(
      (g): LocalShareGroup => ({
        id: g.id, unitLabel: g.unit_label, kind: g.kind, areaM2: g.area_m2 === null ? null : Number(g.area_m2), intendedUse: g.intended_use,
        layout: g.layout, floor: g.floor, ranges: g.ranges, htjId: g.htj_id,
      }),
    ),
    ownerships: owners.map(
      (o): LocalOwnership => ({
        id: o.id, shareGroupId: o.share_group_id, partyId: o.party_id, partyHtjId: o.party_htj_id, name: o.display_name,
        numerator: o.share_numerator, denominator: o.share_denominator, startsOn: toIsoDate(o.starts_on), htjId: o.htj_id,
      }),
    ),
  };
}

function toIsoDate(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return v.slice(0, 10);
}

/**
 * Hakee yhtiön HTJ:stä ja tallentaa erot hyväksyttäviksi. Aiemmat
 * käsittelemättömät erot merkitään korvatuiksi, koska uusi haku on
 * ajantasaisempi. Omistajat haetaan aina suppealla haulla.
 */
export async function runFetchSync(
  tx: Sql,
  client: HtjClient,
  opts: { companyId: string; userId: string | null; target?: "company" | "changes"; purpose?: HtjPurpose },
): Promise<FetchResult> {
  const [company] = await tx.query<CompanyRow>("select id, organization_id, business_id, name, total_shares from er_housing_companies where id = $1", [opts.companyId]);
  if (!company) throw new HtjError("Yhtiötä ei löytynyt.", "not_found");

  const [sync] = await tx.query<{ id: string }>(
    "insert into er_htj_syncs (organization_id, company_id, kind, target, started_by) values ($1,$2,'fetch',$3,$4) returning id",
    [company.organization_id, company.id, opts.target ?? "company", opts.userId],
  );
  const meta: HtjCallMeta = {
    purpose: opts.purpose ?? (opts.target === "changes" ? "change_sync" : "registry_sync"),
    userId: opts.userId,
    organizationId: company.organization_id,
    companyId: company.id,
    syncId: sync.id,
  };
  const htj = withRequestLog(tx, client);

  try {
    const htjCompany = await htj.getCompany(company.business_id, meta);
    if (!htjCompany) {
      throw new HtjError("Yhtiötä ei löytynyt HTJ:stä tällä Y-tunnuksella, tai järjestelmälupa ei kata yhtiötä.", "not_found", 404);
    }
    const shareGroups = await htj.listShareGroups(company.business_id, meta);
    const owners = await htj.listOwners(company.business_id, "narrow", meta);
    const restrictions = await htj.listRestrictions(company.business_id, meta);

    const local = await loadLocalState(tx, company.id);
    const diffs = diffRegistry(local, { shareGroups, owners });
    const warnings = companyWarnings(company, htjCompany);

    await tx.query("update er_htj_diffs set status = 'superseded' where company_id = $1 and status = 'pending'", [company.id]);
    for (const d of diffs) await insertDiff(tx, company, sync.id, d);

    const count = (action: string) => diffs.filter((d) => d.action === action).length;
    const summary = {
      htjCompanyId: htjCompany.htjId,
      shareGroups: shareGroups.length,
      owners: owners.length,
      restrictions: restrictions.length,
      restrictedGroups: [...new Set(restrictions.map((r) => shareGroups.find((g) => g.htjId === r.shareGroupHtjId)?.unitLabel).filter(Boolean))],
      diffs: { add: count("add"), update: count("update"), remove: count("remove") },
      warnings,
    };
    const status = diffs.length === 0 && warnings.length === 0 ? "ok" : "warnings";
    await tx.query("update er_htj_syncs set status = $2, finished_at = now(), summary = $3 where id = $1", [sync.id, status, JSON.stringify(summary)]);
    if (diffs.length === 0) {
      await tx.query("update er_housing_companies set htj_synced_at = now(), htj_id = $2 where id = $1", [company.id, htjCompany.htjId]);
    }
    await audit(tx, { organizationId: company.organization_id, userId: opts.userId, action: "htj_fetch", entity: "housing_company", entityId: company.id, details: { syncId: sync.id, diffs: diffs.length } });
    return { syncId: sync.id, status, diffCount: diffs.length };
  } catch (err) {
    if (!(err instanceof HtjError)) throw err;
    await tx.query("update er_htj_syncs set status = 'error', finished_at = now(), error = $2 where id = $1", [sync.id, err.message]);
    return { syncId: sync.id, status: "error", diffCount: 0, error: err.message };
  }
}

async function insertDiff(tx: Sql, company: CompanyRow, syncId: string, d: DiffItem) {
  await tx.query(
    `insert into er_htj_diffs (organization_id, company_id, sync_id, entity, action, local_id, htj_ref, label, before, after, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [company.organization_id, company.id, syncId, d.entity, d.action, d.localId, d.htjRef, d.label,
      d.before ? JSON.stringify(d.before) : null, d.after ? JSON.stringify(d.after) : null, d.sortOrder],
  );
}

// ---------------------------------------------------------------------------
// Hyväksyntä ja hylkäys
// ---------------------------------------------------------------------------

export class DiffApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffApplyError";
  }
}

interface DiffRow {
  id: string;
  organization_id: string;
  company_id: string;
  sync_id: string;
  entity: "share_group" | "ownership";
  action: "add" | "update" | "remove";
  local_id: string | null;
  htj_ref: string | null;
  label: string;
  before: ShareGroupSnapshot | OwnershipSnapshot | null;
  after: ShareGroupSnapshot | OwnershipSnapshot | null;
}

export interface DecisionResult {
  accepted: number;
  rejected: number;
  remaining: number;
}

/**
 * Hyväksyy tai hylkää erot. Hyväksytyt kirjoitetaan järjestyksessä
 * (päättyvät omistukset → poistuvat osakeryhmät → muutokset → uudet), ja
 * koko erä on yksi transaktio: jos yksikin ero ei mene läpi, mitään ei
 * kirjoiteta ja virhe kertoo, mikä ero esti.
 */
export async function decideDiffs(
  tx: Sql,
  opts: { companyId: string; diffIds: string[] | "all"; decision: "accept" | "reject"; userId: string },
): Promise<DecisionResult> {
  const rows = await tx.query<DiffRow>(
    `select id, organization_id, company_id, sync_id, entity, action, local_id, htj_ref, label, before, after
       from er_htj_diffs
      where company_id = $1 and status = 'pending' and ($2::uuid[] is null or id = any($2::uuid[]))
      order by sort_order, created_at`,
    [opts.companyId, opts.diffIds === "all" ? null : opts.diffIds],
  );
  if (rows.length === 0) return { accepted: 0, rejected: 0, remaining: await pendingCount(tx, opts.companyId) };
  const orgId = rows[0].organization_id;

  if (opts.decision === "reject") {
    await tx.query("update er_htj_diffs set status = 'rejected', decided_by = $2, decided_at = now() where id = any($1::uuid[])", [rows.map((r) => r.id), opts.userId]);
    await audit(tx, { organizationId: orgId, userId: opts.userId, action: "htj_diff_reject", entity: "housing_company", entityId: opts.companyId, details: { count: rows.length } });
    const left = await pendingCount(tx, opts.companyId);
    if (left === 0) await markSynced(tx, opts.companyId);
    return { accepted: 0, rejected: rows.length, remaining: left };
  }

  const touchedGroups = new Set<string>();

  // Osakevälien vaihto kahden osakeryhmän välillä ei saa kaatua
  // päällekkäisyyden estoon, joten muuttuvat välit poistetaan ensin kaikilta.
  for (const r of rows) {
    if (r.entity === "share_group" && r.action === "update" && r.local_id && r.before && r.after) {
      if (shareGroupChanges(r.before as ShareGroupSnapshot, r.after as ShareGroupSnapshot).includes("ranges")) {
        await tx.query("delete from er_share_ranges where share_group_id = $1 and company_id = $2", [r.local_id, opts.companyId]);
      }
    }
  }

  for (const r of rows) {
    try {
      const gid = await applyDiff(tx, r);
      if (gid) touchedGroups.add(gid);
    } catch (err) {
      if (err instanceof DiffApplyError) throw new DiffApplyError(`${r.label}: ${err.message}`);
      const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "23P01") throw new DiffApplyError(`${r.label}: osakevälit menevät päällekkäin toisen osakeryhmän kanssa. Hyväksy myös sen osakeryhmän muutos.`);
      if (code === "23505") throw new DiffApplyError(`${r.label}: yhtiössä on jo osakeryhmä samalla tunnuksella.`);
      throw err;
    }
  }

  await tx.query("update er_htj_diffs set status = 'accepted', decided_by = $2, decided_at = now() where id = any($1::uuid[])", [rows.map((r) => r.id), opts.userId]);
  for (const gid of touchedGroups) await syncPortalAccessForGroup(tx, gid);
  await audit(tx, {
    organizationId: orgId, userId: opts.userId, action: "htj_diff_accept", entity: "housing_company", entityId: opts.companyId,
    details: { count: rows.length, shareGroups: touchedGroups.size },
  });

  const remaining = await pendingCount(tx, opts.companyId);
  if (remaining === 0) await markSynced(tx, opts.companyId);
  return { accepted: rows.length, rejected: 0, remaining };
}

/** Kun kaikki erot on käsitelty (hyväksytty tai hylätty), yhtiö on synkronoitu. */
async function markSynced(tx: Sql, companyId: string) {
  const [latest] = await tx.query<{ id: string; summary: { htjCompanyId?: string; warnings?: string[] } }>(
    "select id, summary from er_htj_syncs where company_id = $1 and kind = 'fetch' and status <> 'error' order by started_at desc limit 1",
    [companyId],
  );
  if (!latest) return;
  await tx.query("update er_housing_companies set htj_synced_at = now(), htj_id = coalesce($2, htj_id) where id = $1", [companyId, latest.summary?.htjCompanyId ?? null]);
  if (!latest.summary?.warnings?.length) await tx.query("update er_htj_syncs set status = 'ok' where id = $1", [latest.id]);
}

async function pendingCount(tx: Sql, companyId: string): Promise<number> {
  const [r] = await tx.query<{ n: number }>("select count(*)::int as n from er_htj_diffs where company_id = $1 and status = 'pending'", [companyId]);
  return r.n;
}

/** Palauttaa osakeryhmän, jonka portaalioikeudet on laskettava uudelleen. */
async function applyDiff(tx: Sql, r: DiffRow): Promise<string | null> {
  if (r.entity === "share_group") {
    if (r.action === "add") return addShareGroup(tx, r, r.after as ShareGroupSnapshot);
    if (r.action === "update") return updateShareGroup(tx, r, r.before as ShareGroupSnapshot, r.after as ShareGroupSnapshot);
    return removeShareGroup(tx, r);
  }
  if (r.action === "add") return addOwnership(tx, r, r.after as OwnershipSnapshot);
  if (r.action === "update") return updateOwnership(tx, r, r.after as OwnershipSnapshot);
  return removeOwnership(tx, r);
}

async function insertRanges(tx: Sql, r: DiffRow, groupId: string, ranges: { first: number; last: number }[]) {
  for (const x of ranges) {
    await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)", [
      r.organization_id, r.company_id, groupId, x.first, x.last,
    ]);
  }
}

async function addShareGroup(tx: Sql, r: DiffRow, a: ShareGroupSnapshot): Promise<string> {
  // Sama tunnus voi olla aiemmin poistetulla osakeryhmällä: otetaan se käyttöön.
  const [existing] = await tx.query<{ id: string; removed_on: string | null }>(
    "select id, removed_on from er_share_groups where company_id = $1 and unit_label = $2", [r.company_id, a.unitLabel],
  );
  let gid: string;
  if (existing) {
    if (!existing.removed_on) throw new DiffApplyError("rekisterissä on jo voimassa oleva osakeryhmä tällä tunnuksella.");
    await tx.query(
      `update er_share_groups set removed_on = null, kind = $2, area_m2 = $3, intended_use = $4, layout = $5, floor = $6, source = 'htj', htj_id = $7 where id = $1`,
      [existing.id, a.kind, a.areaM2, a.intendedUse, a.layout, a.floor, a.htjId],
    );
    await tx.query("delete from er_share_ranges where share_group_id = $1", [existing.id]);
    gid = existing.id;
  } else {
    const [row] = await tx.query<{ id: string }>(
      `insert into er_share_groups (organization_id, company_id, unit_label, kind, area_m2, intended_use, layout, floor, source, htj_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'htj',$9) returning id`,
      [r.organization_id, r.company_id, a.unitLabel, a.kind, a.areaM2, a.intendedUse, a.layout, a.floor, a.htjId],
    );
    gid = row.id;
  }
  await insertRanges(tx, r, gid, a.ranges);
  return gid;
}

async function updateShareGroup(tx: Sql, r: DiffRow, b: ShareGroupSnapshot, a: ShareGroupSnapshot): Promise<string> {
  const updated = await tx.query<{ id: string }>(
    `update er_share_groups set unit_label = $2, kind = $3, area_m2 = coalesce($4, area_m2), intended_use = coalesce($5, intended_use), layout = $6, floor = $7,
            source = 'htj', htj_id = $8
      where id = $1 and company_id = $9 and removed_on is null returning id`,
    [r.local_id, a.unitLabel, a.kind, a.areaM2, a.intendedUse, a.layout, a.floor, a.htjId, r.company_id],
  );
  if (updated.length === 0) throw new DiffApplyError("osakeryhmää ei enää ole rekisterissä. Hae tiedot uudelleen.");
  if (shareGroupChanges(b, a).includes("ranges")) await insertRanges(tx, r, r.local_id!, a.ranges);
  return r.local_id!;
}

async function removeShareGroup(tx: Sql, r: DiffRow): Promise<string> {
  await tx.query(
    `update er_ownerships set ends_on = greatest(current_date - 1, coalesce(starts_on, current_date - 1))
      where share_group_id = $1 and (ends_on is null or ends_on >= current_date)`,
    [r.local_id],
  );
  await tx.query("delete from er_share_ranges where share_group_id = $1 and company_id = $2", [r.local_id, r.company_id]);
  const rows = await tx.query("update er_share_groups set removed_on = current_date where id = $1 and company_id = $2 returning id", [r.local_id, r.company_id]);
  if (rows.length === 0) throw new DiffApplyError("osakeryhmää ei löytynyt.");
  return r.local_id!;
}

async function resolveGroup(tx: Sql, r: DiffRow, a: OwnershipSnapshot): Promise<string> {
  if (a.shareGroupHtjId) {
    const [g] = await tx.query<{ id: string }>("select id from er_share_groups where company_id = $1 and htj_id = $2 and removed_on is null", [r.company_id, a.shareGroupHtjId]);
    if (g) return g.id;
  }
  if (a.localShareGroupId) {
    const [g] = await tx.query<{ id: string }>("select id from er_share_groups where company_id = $1 and id = $2 and removed_on is null", [r.company_id, a.localShareGroupId]);
    if (g) return g.id;
  }
  throw new DiffApplyError(`osakeryhmää ${a.unitLabel} ei ole rekisterissä. Hyväksy ensin osakeryhmän lisäys.`);
}

async function addOwnership(tx: Sql, r: DiffRow, a: OwnershipSnapshot): Promise<string> {
  const gid = await resolveGroup(tx, r, a);
  let partyId: string | null = null;
  if (a.ownerRef) {
    const [p] = await tx.query<{ id: string }>("select id from er_parties where organization_id = $1 and htj_id = $2 order by created_at limit 1", [r.organization_id, a.ownerRef]);
    partyId = p?.id ?? null;
  }
  if (!partyId) {
    // Uudelle osapuolelle VTJ-osoite, ellei turvakieltoa. Olemassa olevan
    // osapuolen yhteystietoja ei korvata, koska ne ovat eRapun omia tietoja.
    const c = a.protected ? null : a.contact;
    const isPerson = a.kind === "person";
    const [p] = await tx.query<{ id: string }>(
      `insert into er_parties (organization_id, kind, first_names, last_name, company_name, business_id, street_address, postal_code, city, htj_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [r.organization_id, a.kind, isPerson ? a.firstNames : null, isPerson ? (a.lastName ?? a.name) : null, isPerson ? null : (a.companyName ?? a.name),
        a.businessId, c?.streetAddress ?? null, c?.postalCode ?? null, c?.city ?? null, a.ownerRef],
    );
    partyId = p.id;
  }
  const [active] = await tx.query<{ id: string }>(
    "select id from er_ownerships where share_group_id = $1 and party_id = $2 and (ends_on is null or ends_on >= current_date) limit 1", [gid, partyId],
  );
  if (active) {
    await tx.query("update er_ownerships set share_numerator = $2, share_denominator = $3, source = 'htj', htj_id = $4 where id = $1", [active.id, a.numerator, a.denominator, a.htjId]);
  } else {
    await tx.query(
      `insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, starts_on, source, htj_id)
       values ($1,$2,$3,$4,$5,$6,'htj',$7)`,
      [r.organization_id, gid, partyId, a.numerator, a.denominator, a.startsOn, a.htjId],
    );
  }
  return gid;
}

async function updateOwnership(tx: Sql, r: DiffRow, a: OwnershipSnapshot): Promise<string> {
  const [row] = await tx.query<{ share_group_id: string; party_id: string }>(
    `update er_ownerships o set share_numerator = $2, share_denominator = $3, source = 'htj', htj_id = $4, starts_on = coalesce(o.starts_on, $5)
       from er_share_groups g
      where o.id = $1 and g.id = o.share_group_id and g.company_id = $6
      returning o.share_group_id, o.party_id`,
    [r.local_id, a.numerator, a.denominator, a.htjId, a.startsOn, r.company_id],
  );
  if (!row) throw new DiffApplyError("omistusta ei enää ole rekisterissä. Hae tiedot uudelleen.");
  if (a.ownerRef) await tx.query("update er_parties set htj_id = $2 where id = $1 and htj_id is null", [row.party_id, a.ownerRef]);
  return row.share_group_id;
}

/**
 * Omistus päättyy edelliseen päivään, jotta portaalioikeus päättyy heti
 * (voimassaolo tarkistetaan ehdolla `ends_on >= current_date`). Samalla
 * päättyy omistajan asuminen huoneistossa; vuokralaisen asumiseen ei kosketa.
 */
async function removeOwnership(tx: Sql, r: DiffRow): Promise<string> {
  const [row] = await tx.query<{ share_group_id: string; party_id: string }>(
    `update er_ownerships o set ends_on = greatest(current_date - 1, coalesce(o.starts_on, current_date - 1))
       from er_share_groups g
      where o.id = $1 and g.id = o.share_group_id and g.company_id = $2
      returning o.share_group_id, o.party_id`,
    [r.local_id, r.company_id],
  );
  if (!row) throw new DiffApplyError("omistusta ei löytynyt.");
  await tx.query(
    `update er_residencies set ends_on = greatest(current_date - 1, coalesce(starts_on, current_date - 1))
      where share_group_id = $1 and party_id = $2 and role = 'owner' and (ends_on is null or ends_on >= current_date)`,
    [row.share_group_id, row.party_id],
  );
  return row.share_group_id;
}

// ---------------------------------------------------------------------------
// Muutostietojen yöajo
// ---------------------------------------------------------------------------

export interface ChangeRunResult {
  organizations: number;
  changes: number;
  companies: number;
  errors: number;
}

/**
 * Hakee muutostiedot organisaatioittain edellisestä onnistuneesta ajosta
 * alkaen ja tekee muuttuneille yhtiöille uuden vertailun. Erot jäävät
 * isännöitsijän hyväksyttäviksi. Mukana vain yhtiöt, joiden alkulataus on
 * tehty (htj_synced_at), koska ensimmäinen vertailu tehdään aina käsin.
 */
export async function runChangeSync(db: Database, client: HtjClient, opts: { since?: Date; defaultLookbackDays?: number } = {}): Promise<ChangeRunResult> {
  const orgs = await db.asService((tx) =>
    tx.query<{ organization_id: string }>(
      "select distinct organization_id from er_housing_companies where htj_synced_at is not null and management_ended_on is null",
    ),
  );
  const result: ChangeRunResult = { organizations: orgs.length, changes: 0, companies: 0, errors: 0 };

  for (const { organization_id: orgId } of orgs) {
    const affected = await db.asService(async (tx) => {
      const [last] = await tx.query<{ started_at: Date | string }>(
        "select started_at from er_htj_syncs where organization_id = $1 and company_id is null and target = 'changes' and status in ('ok', 'warnings') order by started_at desc limit 1",
        [orgId],
      );
      const since = opts.since ?? (last ? new Date(last.started_at) : new Date(Date.now() - (opts.defaultLookbackDays ?? 2) * 86_400_000));
      const [sync] = await tx.query<{ id: string }>(
        "insert into er_htj_syncs (organization_id, kind, target) values ($1, 'fetch', 'changes') returning id", [orgId],
      );
      const companies = await tx.query<{ id: string; business_id: string }>(
        "select id, business_id from er_housing_companies where organization_id = $1 and htj_synced_at is not null and management_ended_on is null",
        [orgId],
      );
      try {
        const changes = await withRequestLog(tx, client).listChanges(since, { purpose: "change_sync", userId: null, organizationId: orgId, syncId: sync.id });
        const byBid = new Map(companies.map((c) => [c.business_id, c.id]));
        const ids = [...new Set(changes.map((c) => byBid.get(c.businessId)).filter((x): x is string => Boolean(x)))];
        const relevant = changes.filter((c) => byBid.has(c.businessId)).length;
        await tx.query("update er_htj_syncs set status = 'ok', finished_at = now(), summary = $2 where id = $1", [
          sync.id, JSON.stringify({ since: since.toISOString(), changes: relevant, companies: ids.length }),
        ]);
        result.changes += relevant;
        return ids;
      } catch (err) {
        if (!(err instanceof HtjError)) throw err;
        await tx.query("update er_htj_syncs set status = 'error', finished_at = now(), error = $2 where id = $1", [sync.id, err.message]);
        result.errors++;
        return [];
      }
    });

    for (const companyId of affected) {
      const r = await db.asService((tx) => runFetchSync(tx, client, { companyId, userId: null, target: "changes", purpose: "change_sync" }));
      result.companies++;
      if (r.status === "error") result.errors++;
    }
  }
  return result;
}
