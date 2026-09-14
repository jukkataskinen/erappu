import type { Sql } from "@/lib/db/types";
import { FinanceError, loadChargeBases } from "./billing";
import { planBasisSuccession } from "./charges";
import { allocateByShares } from "./loans";
import { centsToDecimal, toCents } from "./money";

/**
 * Vastikeperusteiden ja lainaosuuksien kirjoitukset (0004:n taulut).
 */

export interface NewChargeBasis {
  companyId: string;
  chargeType: string;
  label: string | null;
  basis: string;
  unitPrice: string;
  vatPercent: string;
  appliesToKinds: string[] | null;
  startsOn: string;
  decidedOn: string | null;
  decisionNote: string | null;
  htjChargeType: string | null;
}

/**
 * Uusi peruste yhtiökokouksen tai hallituksen päätöksellä. Saman vastikkeen
 * edellinen peruste päättyy automaattisesti uutta edeltävään päivään, jotta
 * historia säilyy eikä kahta hintaa ole voimassa samana päivänä.
 */
export async function addChargeBasis(tx: Sql, input: NewChargeBasis): Promise<{ id: string; ended: number }> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [input.companyId]);
  if (!company) throw new FinanceError("Yhtiötä ei löytynyt.");
  const existing = await loadChargeBases(tx, input.companyId);
  const plan = planBasisSuccession(existing, { charge_type: input.chargeType, applies_to_kinds: input.appliesToKinds, starts_on: input.startsOn });
  if (plan.conflicts.length > 0) {
    throw new FinanceError("Samalle vastikkeelle on jo peruste, joka alkaa samana päivänä tai myöhemmin. Korjaa se ensin.");
  }
  for (const b of plan.toEnd) {
    await tx.query("update er_charge_bases set ends_on = $2 where id = $1", [b.id, plan.endsOn]);
  }
  const [row] = await tx.query<{ id: string }>(
    `insert into er_charge_bases (organization_id, company_id, charge_type, label, basis, unit_price, vat_percent, applies_to_kinds,
        starts_on, decided_on, decision_note, htj_charge_type, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual') returning id`,
    [company.organization_id, input.companyId, input.chargeType, input.label, input.basis, input.unitPrice, input.vatPercent,
      input.appliesToKinds, input.startsOn, input.decidedOn, input.decisionNote, input.htjChargeType],
  );
  return { id: row.id, ended: plan.toEnd.length };
}

/**
 * Lainaosuuslaskelma osakkeiden suhteessa. Alkuperäinen osuus jaetaan
 * pääomasta kaikille osakeryhmille; jäljellä oleva osuus lainan saldosta
 * niille, jotka eivät ole maksaneet osuuttaan kertasuorituksena.
 * Kertasuorituksen tehneiden rivit jätetään ennalleen.
 */
export async function recalculateLoanShares(tx: Sql, loanId: string, companyId: string, today: string): Promise<number> {
  const [loan] = await tx.query<{ organization_id: string; principal_eur: string; balance_eur: string | null; balance_date: string | null }>(
    "select organization_id, principal_eur::text, balance_eur::text, balance_date::text from er_loans where id = $1 and company_id = $2",
    [loanId, companyId],
  );
  if (!loan) throw new FinanceError("Lainaa ei löytynyt.");
  const groups = await tx.query<{ id: string; unit_label: string; share_count: number }>(
    "select id, unit_label, share_count from er_share_groups where company_id = $1 and removed_on is null and share_count > 0",
    [companyId],
  );
  if (groups.length === 0) throw new FinanceError("Yhtiön osakeryhmiltä puuttuvat osakenumerot, joten osuuksia ei voi laskea.");
  const paidOff = new Set(
    (await tx.query<{ share_group_id: string }>("select share_group_id from er_loan_shares where loan_id = $1 and paid_off_on is not null", [loanId])).map((r) => r.share_group_id),
  );

  const original = allocateByShares(toCents(loan.principal_eur), groups);
  const remaining = allocateByShares(toCents(loan.balance_eur ?? loan.principal_eur), groups.filter((g) => !paidOff.has(g.id)));
  const balanceDate = loan.balance_date ?? today;

  let count = 0;
  for (const g of groups) {
    if (paidOff.has(g.id)) continue;
    await tx.query(
      `insert into er_loan_shares (organization_id, loan_id, share_group_id, original_eur, remaining_eur, balance_date)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (loan_id, share_group_id) do update set original_eur = excluded.original_eur, remaining_eur = excluded.remaining_eur,
         balance_date = excluded.balance_date`,
      [loan.organization_id, loanId, g.id, centsToDecimal(original.get(g.id)!), centsToDecimal(remaining.get(g.id) ?? 0n), balanceDate],
    );
    count++;
  }
  return count;
}
