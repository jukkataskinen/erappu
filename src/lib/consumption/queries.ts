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
