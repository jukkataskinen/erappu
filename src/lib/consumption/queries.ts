import type { Sql } from "@/lib/db";
import type { IsoDate } from "@/lib/tasks/dates";
import type { ConsumptionUnit, Utility } from "./labels";

export interface ReadingRow {
  id: string;
  company_id: string;
  utility: Utility;
  period_start: IsoDate;
  period_end: IsoDate;
  amount: string;
  unit: ConsumptionUnit;
  cost_eur: string | null;
  source: "manual" | "csv";
}

/** Yhtiötason lukemat, jotka osuvat annettuihin vuosiin. */
export async function listReadings(tx: Sql, companyId: string, fromYear: number, toYear: number): Promise<ReadingRow[]> {
  return tx.query<ReadingRow>(
    `select id, company_id, utility, to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end,
            amount::text as amount, unit, cost_eur::text as cost_eur, source
       from er_consumption_readings
      where company_id = $1 and share_group_id is null
        and period_end >= make_date($2, 1, 1) and period_start <= make_date($3, 12, 31)
      order by utility, period_start`,
    [companyId, fromYear, toYear],
  );
}

/** Huoneistoalan summa (m²) kulutuksen suhteuttamiseen. */
export async function companyArea(tx: Sql, companyId: string): Promise<number> {
  const [row] = await tx.query<{ area: string | null }>(
    "select sum(area_m2)::text as area from er_share_groups where company_id = $1 and removed_on is null and kind in ('apartment', 'commercial')",
    [companyId],
  );
  return Number(row?.area ?? 0);
}

export interface ReadingInput {
  organizationId: string;
  companyId: string;
  utility: Utility;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amount: number;
  unit: ConsumptionUnit;
  costEur: number | null;
  source: "manual" | "csv";
  createdBy: string;
}

/** Sama yhtiö, laji ja jakso päivitetään, jotta tuonnin voi ajaa uudelleen. */
export async function upsertReading(tx: Sql, r: ReadingInput): Promise<"inserted" | "updated"> {
  const [row] = await tx.query<{ inserted: boolean }>(
    `insert into er_consumption_readings (organization_id, company_id, utility, period_start, period_end, amount, unit, cost_eur, source, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (company_id, utility, period_start, period_end) where share_group_id is null
     do update set amount = excluded.amount, unit = excluded.unit, cost_eur = excluded.cost_eur, source = excluded.source
     returning (xmax = 0) as inserted`,
    [r.organizationId, r.companyId, r.utility, r.periodStart, r.periodEnd, r.amount, r.unit, r.costEur, r.source, r.createdBy],
  );
  return row.inserted ? "inserted" : "updated";
}

export interface MeteredWaterRow {
  billing_run_id: string;
  period_start: string;
  period_end: string;
  units: number;
  metered_m3: number;
  metered_eur: number | null;
  /** Yhtiön päämittarin kulutus jaksoilta, jotka ovat kokonaan tasausjakson sisällä; null = ei rivejä. */
  main_m3: number | null;
}

/** Vesitasauksista kirjattu huoneistojen kulutus ja vertailu yhtiön päämittariin (0109). */
export function listMeteredWater(tx: Sql, companyId: string): Promise<MeteredWaterRow[]> {
  return tx.query<MeteredWaterRow>(
    `with runs as (
       select billing_run_id, min(period_start) as period_start, max(period_end) as period_end, count(*)::int as units,
              sum(amount)::float8 as metered_m3, sum(cost_eur)::float8 as metered_eur
         from er_consumption_readings
        where company_id = $1 and source = 'water_billing' and billing_run_id is not null
        group by billing_run_id)
     select r.billing_run_id, r.period_start::text, r.period_end::text, r.units, r.metered_m3, r.metered_eur,
            (select sum(c.amount)::float8 from er_consumption_readings c
              where c.company_id = $1 and c.share_group_id is null and c.utility = 'water'
                and c.period_start >= r.period_start and c.period_end <= r.period_end) as main_m3
       from runs r
      order by r.period_end desc
      limit 10`,
    [companyId],
  );
}
