import type { Sql } from "@/lib/db/types";
import { ensureUnitNumbers, FinanceError, getBillingSettings, loadChargeBases, loadOwnershipsForBilling } from "@/lib/finance/billing";
import { addDays, isIsoDate } from "@/lib/finance/dates";
import { centsToDecimal } from "@/lib/finance/money";
import { primaryPayer } from "@/lib/finance/payers";
import { companyReference } from "@/lib/finance/references";
import { readingIssues } from "./checks";
import { lastBilledReadings, previousReadings } from "./queries";
import { buildSettlementLines, type MeterKind, type MeterReading, type WaterAdvance, type WaterMeter } from "./settlement";

/**
 * Vesimittareiden, lukemien, ennakoiden ja tasauslaskun muutokset.
 * Kutsujan RLS-transaktio.
 */

async function companyOrg(tx: Sql, companyId: string): Promise<string> {
  const [c] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
  if (!c) throw new FinanceError("Yhtiötä ei löytynyt.");
  return c.organization_id;
}

async function groupInCompany(tx: Sql, companyId: string, shareGroupId: string): Promise<void> {
  const [g] = await tx.query("select 1 from er_share_groups where id = $1 and company_id = $2", [shareGroupId, companyId]);
  if (!g) throw new FinanceError("Huoneistoa ei löytynyt yhtiöstä.");
}

// ---------------------------------------------------------------------------
// Mittarit
// ---------------------------------------------------------------------------

export interface NewMeter {
  companyId: string;
  shareGroupId: string;
  kind: MeterKind;
  meterNumber: string | null;
  location: string | null;
  installedOn: string;
  startReading: string;
  notes: string | null;
}

export async function addMeter(tx: Sql, m: NewMeter): Promise<string> {
  const org = await companyOrg(tx, m.companyId);
  await groupInCompany(tx, m.companyId, m.shareGroupId);
  const [row] = await tx.query<{ id: string }>(
    `insert into er_water_meters (organization_id, company_id, share_group_id, kind, meter_number, location, installed_on, start_reading, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [org, m.companyId, m.shareGroupId, m.kind, m.meterNumber, m.location, m.installedOn, m.startReading, m.notes],
  );
  return row.id;
}

/**
 * Mittarin vaihto: vanha mittari poistuu loppulukemalla, ja uusi mittari
 * (jos annettu) alkaa samana päivänä omalla aloituslukemallaan. Vanhan
 * mittarin kulutus laskutetaan seuraavassa tasauksessa.
 */
export async function replaceMeter(
  tx: Sql,
  opts: {
    companyId: string;
    meterId: string;
    removedOn: string;
    finalReading: string;
    newMeterNumber: string | null;
    newStartReading: string | null;
  },
): Promise<string | null> {
  const [old] = await tx.query<{
    share_group_id: string;
    kind: MeterKind;
    location: string | null;
    installed_on: string;
    removed_on: string | null;
  }>("select share_group_id, kind, location, installed_on::text, removed_on::text from er_water_meters where id = $1 and company_id = $2", [
    opts.meterId,
    opts.companyId,
  ]);
  if (!old) throw new FinanceError("Mittaria ei löytynyt.");
  if (old.removed_on) throw new FinanceError("Mittari on jo poistettu.");
  if (opts.removedOn < old.installed_on) throw new FinanceError("Poistopäivä on ennen asennusta.");
  await tx.query("update er_water_meters set removed_on = $2, final_reading = $3 where id = $1", [opts.meterId, opts.removedOn, opts.finalReading]);
  if (opts.newStartReading === null) return null;
  return addMeter(tx, {
    companyId: opts.companyId,
    shareGroupId: old.share_group_id,
    kind: old.kind,
    meterNumber: opts.newMeterNumber,
    location: old.location,
    installedOn: opts.removedOn,
    startReading: opts.newStartReading,
    notes: null,
  });
}

/** Mittarin voi poistaa kokonaan vain, jos sillä ei ole lukemia eikä laskutusta (virheellinen kirjaus). */
export async function deleteMeter(tx: Sql, companyId: string, meterId: string): Promise<void> {
  const [used] = await tx.query<{ n: number }>(
    `select ((select count(*) from er_water_readings where meter_id = $1) + (select count(*) from er_billing_lines where meter_id = $1))::int as n`,
    [meterId],
  );
  if (used && used.n > 0) throw new FinanceError("Mittarilla on lukemia tai laskutusta. Merkitse se vaihdetuksi, älä poista.");
  await tx.query("delete from er_water_meters where id = $1 and company_id = $2", [meterId, companyId]);
}

// ---------------------------------------------------------------------------
// Ennakot
// ---------------------------------------------------------------------------

/** Uusi ennakko päättää huoneiston edellisen ennakon alkupäivää edeltävänä päivänä. 0 € = ennakko loppuu. */
export async function setAdvance(
  tx: Sql,
  opts: {
    companyId: string;
    shareGroupId: string;
    monthlyEur: string;
    startsOn: string;
    note: string | null;
  },
): Promise<void> {
  const org = await companyOrg(tx, opts.companyId);
  await groupInCompany(tx, opts.companyId, opts.shareGroupId);
  const [later] = await tx.query("select 1 from er_water_advances where share_group_id = $1 and starts_on >= $2", [opts.shareGroupId, opts.startsOn]);
  if (later) throw new FinanceError("Huoneistolla on jo ennakko, joka alkaa samana päivänä tai myöhemmin. Poista se ensin.");
  await tx.query("update er_water_advances set ends_on = $3 where share_group_id = $1 and starts_on < $2 and (ends_on is null or ends_on >= $2)", [
    opts.shareGroupId,
    opts.startsOn,
    addDays(opts.startsOn, -1),
  ]);
  if (Number(opts.monthlyEur) === 0) return;
  await tx.query("insert into er_water_advances (organization_id, company_id, share_group_id, monthly_eur, starts_on, note) values ($1,$2,$3,$4,$5,$6)", [
    org,
    opts.companyId,
    opts.shareGroupId,
    opts.monthlyEur,
    opts.startsOn,
    opts.note,
  ]);
}

export async function deleteAdvance(tx: Sql, companyId: string, advanceId: string): Promise<void> {
  await tx.query("delete from er_water_advances where id = $1 and company_id = $2", [advanceId, companyId]);
}

// ---------------------------------------------------------------------------
// Lukukierrokset ja lukemat
// ---------------------------------------------------------------------------

export async function createRound(
  tx: Sql,
  opts: {
    companyId: string;
    readOn: string;
    portalOpen: boolean;
    note: string | null;
    userId: string;
    /** Ilmoituksen määräpäivä; oletus lukemapäivä + 7 pv. */
    reportBy?: string | null;
  },
): Promise<string> {
  const org = await companyOrg(tx, opts.companyId);
  const reportBy = opts.reportBy ?? addDays(opts.readOn, 7);
  if (reportBy < opts.readOn) throw new FinanceError("Ilmoituksen määräpäivä on ennen lukemapäivää.");
  const [row] = await tx.query<{ id: string }>(
    `insert into er_water_reading_rounds (organization_id, company_id, read_on, report_by, portal_open, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (company_id, read_on) do nothing returning id`,
    [org, opts.companyId, opts.readOn, reportBy, opts.portalOpen, opts.note, opts.userId],
  );
  if (!row) throw new FinanceError("Samalle päivälle on jo lukukierros.");
  return row.id;
}

export async function setRoundStatus(tx: Sql, companyId: string, roundId: string, fields: { status?: "open" | "closed"; portalOpen?: boolean }): Promise<void> {
  await tx.query(
    `update er_water_reading_rounds set status = coalesce($3, status), portal_open = coalesce($4, portal_open) where id = $1 and company_id = $2`,
    [roundId, companyId, fields.status ?? null, fields.portalOpen ?? null],
  );
}

/** Lukema-arvo kannan muotoon: "1 234,5" → "1234.5". null = ei kelpaa. */
export function parseReading(value: string): string | null {
  const v = value.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(v)) return null;
  return v;
}

/** Poikkeavat lukemat (pienempi kuin edellinen, kulutus alle 2 tai yli 500 m³) vaativat kuittauksen. */
async function assertPlausible(
  tx: Sql,
  companyId: string,
  readOn: string,
  readings: { meterId: string; value: string | null }[],
  confirmed: boolean,
): Promise<void> {
  if (confirmed) return;
  const previous = await previousReadings(tx, companyId, readOn);
  const odd = readings.filter((r) => r.value !== null && readingIssues(previous.get(r.meterId)?.value, r.value).length > 0);
  if (odd.length === 0) return;
  throw new FinanceError(
    odd.length === 1
      ? "Lukema poikkeaa edellisestä (pienempi, tai kulutus alle 2 tai yli 500 m³). Tarkista lukema ja kuittaa se oikeaksi."
      : `${odd.length} lukemaa poikkeaa edellisestä (pienempi, tai kulutus alle 2 tai yli 500 m³). Tarkista lukemat ja kuittaa ne oikeiksi.`,
  );
}

/**
 * Henkilökunnan lukemat kierrokselle. Tyhjä arvo poistaa lukeman.
 * Palauttaa tallennettujen ja poistettujen määrät.
 */
export async function saveStaffReadings(
  tx: Sql,
  opts: {
    companyId: string;
    roundId: string;
    userId: string;
    readings: { meterId: string; value: string | null }[];
    confirmed?: boolean;
  },
): Promise<{ saved: number; removed: number }> {
  const [round] = await tx.query<{
    organization_id: string;
    read_on: string;
    locked: boolean;
  }>(
    `select r.organization_id, r.read_on::text,
            exists (select 1 from er_billing_runs b where b.reading_round_id = r.id and b.status <> 'cancelled') as locked
       from er_water_reading_rounds r where r.id = $1 and r.company_id = $2`,
    [opts.roundId, opts.companyId],
  );
  if (!round) throw new FinanceError("Lukukierrosta ei löytynyt.");
  if (round.locked) throw new FinanceError("Kierroksesta on tehty tasauslaskutus. Peru laskutusajo ennen lukemien muuttamista.");
  const meters = new Set((await tx.query<{ id: string }>("select id from er_water_meters where company_id = $1", [opts.companyId])).map((m) => m.id));
  await assertPlausible(tx, opts.companyId, round.read_on, opts.readings, opts.confirmed ?? false);
  let saved = 0;
  let removed = 0;
  for (const r of opts.readings) {
    if (!meters.has(r.meterId)) continue;
    if (r.value === null) {
      const del = await tx.query("delete from er_water_readings where meter_id = $1 and round_id = $2 returning id", [r.meterId, opts.roundId]);
      removed += del.length;
      continue;
    }
    const changed = await tx.query(
      `insert into er_water_readings (organization_id, meter_id, round_id, read_on, reading, source, entered_by)
       values ($1,$2,$3,$4,$5,'staff',$6)
       on conflict (meter_id, round_id) do update set reading = excluded.reading, source = 'staff', entered_by = excluded.entered_by
         where er_water_readings.reading <> excluded.reading
       returning id`,
      [round.organization_id, r.meterId, opts.roundId, round.read_on, r.value, opts.userId],
    );
    saved += changed.length;
  }
  return { saved, removed };
}

/**
 * Osakkaan tai asukkaan ilmoittama lukema portaalissa. Kanta tarkistaa
 * oikeuden (oma mittari, avoin kierros); henkilökunnan kirjaamaa lukemaa
 * ei korvata.
 */
export async function reportPortalReading(
  tx: Sql,
  opts: {
    meterId: string;
    roundId: string;
    value: string;
    userId: string;
    confirmed?: boolean;
  },
): Promise<boolean> {
  const [ctx] = await tx.query<{
    organization_id: string;
    company_id: string;
    read_on: string;
    existing_source: string | null;
  }>(
    `select m.organization_id, m.company_id, r.read_on::text,
            (select x.source from er_water_readings x where x.meter_id = m.id and x.round_id = r.id) as existing_source
       from er_water_meters m join er_water_reading_rounds r on r.company_id = m.company_id
      where m.id = $1 and r.id = $2`,
    [opts.meterId, opts.roundId],
  );
  if (!ctx) return false;
  if (ctx.existing_source === "staff") throw new FinanceError("Isännöitsijä on jo kirjannut tämän mittarin lukeman.");
  await assertPlausible(tx, ctx.company_id, ctx.read_on, [{ meterId: opts.meterId, value: opts.value }], opts.confirmed ?? false);
  const rows = await tx.query(
    `insert into er_water_readings (organization_id, meter_id, round_id, read_on, reading, source, entered_by)
     values ($1,$2,$3,$4,$5,'portal',$6)
     on conflict (meter_id, round_id) do update set reading = excluded.reading, entered_by = excluded.entered_by
     returning id`,
    [ctx.organization_id, opts.meterId, opts.roundId, ctx.read_on, opts.value, opts.userId],
  );
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Tasauslaskutus
// ---------------------------------------------------------------------------

/** Tasauskauden oletus: edellisen tasauksen jälkeisestä päivästä kierroksen päivään, muuten vuosi taaksepäin. */
export async function defaultSettlementPeriod(tx: Sql, companyId: string, readOn: string): Promise<{ start: string; end: string }> {
  const [prev] = await tx.query<{ period_end: string }>(
    `select period_end::text from er_billing_runs
      where company_id = $1 and kind = 'water_settlement' and status <> 'cancelled' and period_end < $2
      order by period_end desc limit 1`,
    [companyId, readOn],
  );
  if (prev) return { start: addDays(prev.period_end, 1), end: readOn };
  // Vuosi taaksepäin: 31.12.2026 → 1.1.2026. Karkauspäivä 29.2. → 1.3.
  const sameDay = `${Number(readOn.slice(0, 4)) - 1}${readOn.slice(4)}`;
  return {
    start: isIsoDate(sameDay) ? addDays(sameDay, 1) : `${sameDay.slice(0, 4)}-03-01`,
    end: readOn,
  };
}

export async function createWaterSettlement(
  tx: Sql,
  opts: {
    companyId: string;
    roundId: string;
    periodStart: string;
    periodEnd: string;
    dueOn: string | null;
    userId: string;
  },
): Promise<{ runId: string; warnings: string[] }> {
  const settings = await getBillingSettings(tx, opts.companyId);
  if (!settings) throw new FinanceError("Tallenna ensin yhtiön laskutusasetukset (yhtiön numero viitettä varten).");
  if (opts.periodEnd < opts.periodStart) throw new FinanceError("Kauden loppu on ennen alkua.");
  const [round] = await tx.query<{ read_on: string }>("select read_on::text from er_water_reading_rounds where id = $1 and company_id = $2", [
    opts.roundId,
    opts.companyId,
  ]);
  if (!round) throw new FinanceError("Lukukierrosta ei löytynyt.");
  const [existing] = await tx.query("select 1 from er_billing_runs where reading_round_id = $1 and status <> 'cancelled'", [opts.roundId]);
  if (existing) throw new FinanceError("Kierroksesta on jo tasauslaskutus. Peru se ensin, jos haluat laskea uudelleen.");

  const [bases, groups, meters, readings, lastBilled, advances, ownerships, unitNumbers] = await Promise.all([
    loadChargeBases(tx, opts.companyId),
    tx.query<{ id: string; unit_label: string }>(
      "select id, unit_label from er_share_groups where company_id = $1 and (removed_on is null or removed_on > $2::date)",
      [opts.companyId, opts.periodStart],
    ),
    tx.query<WaterMeter>(
      `select id, share_group_id, kind, meter_number, installed_on::text, start_reading::text, removed_on::text, final_reading::text
         from er_water_meters where company_id = $1`,
      [opts.companyId],
    ),
    tx.query<{ meter_id: string; reading: string; read_on: string }>(
      "select meter_id, reading::text, read_on::text from er_water_readings where round_id = $1",
      [opts.roundId],
    ),
    lastBilledReadings(tx, opts.companyId),
    tx.query<WaterAdvance>("select share_group_id, monthly_eur::text, starts_on::text, ends_on::text from er_water_advances where company_id = $1", [
      opts.companyId,
    ]),
    loadOwnershipsForBilling(tx, opts.companyId),
    ensureUnitNumbers(tx, opts.companyId),
  ]);

  let result;
  try {
    result = buildSettlementLines({
      period: { start: opts.periodStart, end: opts.periodEnd },
      roundDate: round.read_on,
      bases,
      groups,
      meters,
      roundReadings: new Map<string, MeterReading>(readings.map((r) => [r.meter_id, { value: r.reading, on: r.read_on }])),
      lastBilled,
      advances,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NO_WATER_PRICE") {
      throw new FinanceError(
        `Vesimaksun yksikköhinta puuttuu. Lisää talouteen vastikeperuste "Vesimaksu", peruste "Mittarin mukaan", voimassa ${round.read_on.split("-").reverse().map(Number).join(".")}.`,
      );
    }
    throw err;
  }
  if (result.lines.length === 0) throw new FinanceError("Tasauslaskulle ei muodostunut rivejä. Tarkista mittarit, lukemat ja ennakot.");

  const warnings = [...result.warnings];
  let missingPayer = 0;
  const payers = new Map<string, string | null>();
  for (const g of groups) {
    const payer = primaryPayer(
      ownerships.filter((o) => o.share_group_id === g.id),
      opts.periodEnd,
    );
    payers.set(g.id, payer?.party_id ?? null);
    if (!payer && result.lines.some((l) => l.shareGroupId === g.id)) {
      missingPayer++;
      warnings.push(`${g.unit_label}: omistaja puuttuu, maksaja on tyhjä`);
    }
  }
  if (result.creditGroups > 0) warnings.push(`${result.creditGroups} huoneiston tasaus on hyvitys (ennakot ylittävät kulutuksen).`);

  const byType: Record<string, bigint> = {};
  let total = 0n;
  for (const l of result.lines) {
    byType[l.chargeType] = (byType[l.chargeType] ?? 0n) + l.amountCents;
    total += l.amountCents;
  }
  const totals = {
    total_eur: centsToDecimal(total),
    by_charge_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, centsToDecimal(v)])),
    line_count: result.lines.length,
    group_count: new Set(result.lines.map((l) => l.shareGroupId)).size,
    missing_payer_count: missingPayer,
    warnings,
  };

  const [run] = await tx.query<{ id: string }>(
    `insert into er_billing_runs (organization_id, company_id, kind, reading_round_id, period_start, period_end, due_on, created_by, totals)
     values ($1,$2,'water_settlement',$3,$4,$5,$6,$7,$8) returning id`,
    [settings.organization_id, opts.companyId, opts.roundId, opts.periodStart, opts.periodEnd, opts.dueOn, opts.userId, JSON.stringify(totals)],
  );
  for (const l of result.lines) {
    const seq = unitNumbers.get(l.shareGroupId);
    if (!seq) throw new FinanceError("Huoneistolta puuttuu viitteen järjestysnumero.");
    await tx.query(
      `insert into er_billing_lines (organization_id, run_id, share_group_id, payer_party_id, charge_basis_id, charge_type, description, quantity,
          unit_price, amount_eur, vat_percent, reference_number, line_no, meter_id, reading_start, reading_start_on, reading_end, reading_end_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        settings.organization_id,
        run.id,
        l.shareGroupId,
        payers.get(l.shareGroupId) ?? null,
        l.chargeBasisId,
        l.chargeType,
        l.description,
        l.quantity,
        l.unitPrice,
        centsToDecimal(l.amountCents),
        l.vatPercent,
        companyReference(settings.company_number, seq),
        l.lineNo,
        l.meterId,
        l.readingStart?.value ?? null,
        l.readingStart?.on ?? null,
        l.readingEnd?.value ?? null,
        l.readingEnd?.on ?? null,
      ],
    );
  }
  // Kierros suljetaan: lukemat on laskutettu. Ajon peruminen ei avaa sitä automaattisesti.
  await tx.query("update er_water_reading_rounds set status = 'closed' where id = $1", [opts.roundId]);
  return { runId: run.id, warnings };
}
