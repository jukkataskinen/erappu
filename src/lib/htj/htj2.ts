import type { Sql } from "@/lib/db";
import { isKnownWorkType, WORK_TYPES } from "@/lib/maintenance/work-types";
import { htj2Obligation, type Obligation } from "./obligation";
import type { HtjSubmissionKind } from "./types";

/**
 * HTJ2-tiedot yhtiöittäin: yhteenveto käsin ilmoittamista varten,
 * puutteiden tunnistus ja ilmoitusten sisällön muodostus.
 *
 * Päivämäärät luetaan tekstinä (`::text`), jotta ne eivät siirry
 * aikavyöhykkeen takia päivällä.
 */

export const SUBMISSION_KINDS: HtjSubmissionKind[] = ["charges", "loans", "loan_shares", "maintenance_works", "maintenance_needs"];

export const SUBMISSION_KIND_LABEL: Record<HtjSubmissionKind, string> = {
  charges: "Vastikkeet",
  loans: "Yhtiölainat",
  loan_shares: "Lainaosuudet",
  maintenance_works: "Kunnossapito- ja muutostyöt",
  maintenance_needs: "Kunnossapitotarveselvitys",
};

export const HTJ_CHARGE_TYPE_LABEL: Record<string, string> = {
  hoitovastike: "Hoitovastike",
  maavastike: "Maavastike",
  lammitysvastike: "Lämmitysvastike",
  paaomavastike: "Pääomavastike",
};

export const CHARGE_BASIS_UNIT: Record<string, string> = {
  area_m2: "€/m²/kk",
  share: "€/osake/kk",
  unit: "€/huoneisto/kk",
  person: "€/henkilö/kk",
  meter: "€/mittari",
  fixed: "€/kk",
};

export interface Htj2Company {
  id: string;
  organization_id: string;
  name: string;
  business_id: string;
  company_form: string;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  total_shares: number | null;
  htj_synced_at: string | null;
}

export interface Htj2Group {
  id: string;
  unit_label: string;
  kind: string;
  area_m2: string | null;
  share_count: number;
  htj_id: string | null;
}

export interface Htj2Charge {
  id: string;
  charge_type: string;
  label: string | null;
  basis: string;
  unit_price: string;
  starts_on: string;
  ends_on: string | null;
  decided_on: string | null;
  htj_charge_type: string | null;
  htj_submitted_at: string | null;
}

export interface Htj2Loan {
  id: string;
  name: string;
  lender: string | null;
  principal_eur: string;
  drawn_on: string | null;
  due_on: string | null;
  interest_terms: string | null;
  undrawn_eur: string;
  balance_eur: string | null;
  balance_date: string | null;
  allocated: boolean;
  htj_id: string | null;
  htj_submitted_at: string | null;
}

export interface Htj2LoanShare {
  id: string;
  loan_id: string;
  share_group_id: string;
  unit_label: string;
  group_htj_id: string | null;
  original_eur: string;
  remaining_eur: string;
  balance_date: string;
  paid_off_on: string | null;
  htj_submitted_at: string | null;
}

export interface Htj2Work {
  id: string;
  project: string;
  work_type: string;
  completed_year: number | null;
  completed_on: string | null;
  performed_by: string;
  unit_label: string | null;
  htj_id: string | null;
  htj_submitted_at: string | null;
}

export interface Htj2Need {
  id: string;
  planned_year: number;
  target: string;
  action: string;
  work_type: string | null;
  estimate_eur: string | null;
  affects_residents: boolean;
  status: string;
  htj_submitted_at: string | null;
}

export interface Htj2Data {
  company: Htj2Company;
  groups: Htj2Group[];
  charges: Htj2Charge[];
  loans: Htj2Loan[];
  loanShares: Htj2LoanShare[];
  works: Htj2Work[];
  needs: Htj2Need[];
  today: string;
  year: number;
}

export async function loadHtj2Data(tx: Sql, companyId: string, today: string): Promise<Htj2Data | null> {
  const [company] = await tx.query<Htj2Company>(
    "select id, organization_id, name, business_id, company_form, street_address, postal_code, city, total_shares, htj_synced_at::text from er_housing_companies where id = $1",
    [companyId],
  );
  if (!company) return null;
  const year = Number(today.slice(0, 4));
  const [groups, charges, loans, loanShares, works, needs] = await Promise.all([
    tx.query<Htj2Group>(
      `select id, unit_label, kind, area_m2::text, share_count, htj_id from er_share_groups
        where company_id = $1 and removed_on is null order by length(unit_label), unit_label`,
      [companyId],
    ),
    // Voimassa olevat ja tulevat vastikkeet.
    tx.query<Htj2Charge>(
      `select id, charge_type, label, basis, unit_price::text, starts_on::text, ends_on::text, decided_on::text, htj_charge_type, htj_submitted_at::text
         from er_charge_bases where company_id = $1 and (ends_on is null or ends_on >= $2::date)
        order by starts_on, charge_type`,
      [companyId, today],
    ),
    tx.query<Htj2Loan>(
      `select id, name, lender, principal_eur::text, drawn_on::text, due_on::text, interest_terms, undrawn_eur::text, balance_eur::text, balance_date::text,
              allocated, htj_id, htj_submitted_at::text
         from er_loans where company_id = $1 order by drawn_on nulls last, name`,
      [companyId],
    ),
    tx.query<Htj2LoanShare>(
      `select s.id, s.loan_id, s.share_group_id, g.unit_label, g.htj_id as group_htj_id, s.original_eur::text, s.remaining_eur::text, s.balance_date::text,
              s.paid_off_on::text, s.htj_submitted_at::text
         from er_loan_shares s join er_loans l on l.id = s.loan_id join er_share_groups g on g.id = s.share_group_id
        where l.company_id = $1 order by length(g.unit_label), g.unit_label`,
      [companyId],
    ),
    tx.query<Htj2Work>(
      `select w.id, w.project, w.work_type, w.completed_year, w.completed_on::text, w.performed_by, g.unit_label, w.htj_id, w.htj_submitted_at::text
         from er_maintenance_works w left join er_share_groups g on g.id = w.share_group_id
        where w.company_id = $1 order by w.completed_year desc nulls first, w.project`,
      [companyId],
    ),
    tx.query<Htj2Need>(
      `select id, planned_year, target, action, work_type, estimate_eur::text, affects_residents, status, htj_submitted_at::text
         from er_maintenance_needs where company_id = $1 and planned_year between $2 and $3 and status not in ('cancelled')
        order by planned_year, target`,
      [companyId, year, year + 5],
    ),
  ]);
  return { company, groups, charges, loans, loanShares, works, needs, today, year };
}

// ---------------------------------------------------------------------------
// Puhtaat apurit
// ---------------------------------------------------------------------------

export const isCurrentCharge = (c: Pick<Htj2Charge, "starts_on" | "ends_on">, today: string) => c.starts_on <= today && (c.ends_on === null || c.ends_on >= today);

export const isOpenLoan = (l: Pick<Htj2Loan, "balance_eur">) => l.balance_eur === null || Number(l.balance_eur) > 0;

export function obligationFor(data: Pick<Htj2Data, "groups" | "loans">): Obligation {
  return htj2Obligation({
    apartmentCount: data.groups.filter((g) => g.kind === "apartment").length,
    commercialCount: data.groups.filter((g) => g.kind === "commercial").length,
    loans: data.loans.map((l) => ({ allocated: l.allocated, balanceEur: l.balance_eur === null ? null : Number(l.balance_eur) })),
  });
}

export interface Gap {
  area: HtjSubmissionKind | "registry";
  severity: "alert" | "warn";
  message: string;
}

/** Puutteet, jotka estävät tai heikentävät HTJ2-ilmoitusta. */
export function findGaps(data: Htj2Data): Gap[] {
  const gaps: Gap[] = [];
  const units = data.groups.filter((g) => g.kind === "apartment" || g.kind === "commercial");

  if (data.groups.length === 0) gaps.push({ area: "registry", severity: "alert", message: "Yhtiöllä ei ole osakeryhmiä rekisterissä." });
  const noShares = data.groups.filter((g) => g.share_count === 0).map((g) => g.unit_label);
  if (noShares.length) gaps.push({ area: "registry", severity: "warn", message: `Osakenumerot puuttuvat: ${noShares.join(", ")}.` });

  const current = data.charges.filter((c) => isCurrentCharge(c, data.today));
  if (!current.some((c) => c.htj_charge_type === "hoitovastike")) {
    gaps.push({ area: "charges", severity: "alert", message: "Voimassa oleva hoitovastike puuttuu tai sille ei ole merkitty HTJ-vastikelajia." });
  }
  const untyped = current.filter((c) => ["maintenance", "land", "heating", "capital"].includes(c.charge_type) && !c.htj_charge_type);
  if (untyped.length) gaps.push({ area: "charges", severity: "warn", message: `${untyped.length} vastikkeelta puuttuu HTJ-vastikelaji.` });
  const undecided = data.charges.filter((c) => c.htj_charge_type && !c.decided_on);
  if (undecided.length) gaps.push({ area: "charges", severity: "warn", message: `${undecided.length} vastikkeelta puuttuu päätöspäivä.` });
  if (data.charges.some((c) => c.basis === "area_m2")) {
    const noArea = units.filter((g) => g.area_m2 === null).map((g) => g.unit_label);
    if (noArea.length) gaps.push({ area: "charges", severity: "alert", message: `Pinta-ala puuttuu, vaikka vastike on €/m²: ${noArea.join(", ")}.` });
  }

  for (const loan of data.loans.filter((l) => l.allocated && isOpenLoan(l))) {
    const shares = data.loanShares.filter((s) => s.loan_id === loan.id && !s.paid_off_on);
    if (shares.length === 0) {
      gaps.push({ area: "loan_shares", severity: "alert", message: `Lainalta ${loan.name} puuttuvat lainaosuudet.` });
    } else {
      const covered = new Set(shares.map((s) => s.share_group_id));
      const paid = new Set(data.loanShares.filter((s) => s.loan_id === loan.id && s.paid_off_on).map((s) => s.share_group_id));
      const missing = units.filter((g) => !covered.has(g.id) && !paid.has(g.id)).map((g) => g.unit_label);
      if (missing.length) gaps.push({ area: "loan_shares", severity: "warn", message: `Lainalta ${loan.name} puuttuu lainaosuus: ${missing.join(", ")} (tarkista kertasuoritukset).` });
    }
    if (loan.balance_eur === null || !loan.balance_date) gaps.push({ area: "loans", severity: "warn", message: `Lainalta ${loan.name} puuttuu saldo tai saldopäivä.` });
  }

  if (data.works.length === 0) gaps.push({ area: "maintenance_works", severity: "warn", message: "Kunnossapito- ja muutostöitä ei ole kirjattu." });
  const noYear = data.works.filter((w) => w.completed_year === null);
  if (noYear.length) gaps.push({ area: "maintenance_works", severity: "alert", message: `${noYear.length} työltä puuttuu valmistumisvuosi.` });
  const unknownType = data.works.filter((w) => !isKnownWorkType(w.work_type));
  if (unknownType.length) gaps.push({ area: "maintenance_works", severity: "warn", message: `${unknownType.length} työn työlaji ei ole luettelossa (${WORK_TYPES.length} lajia).` });

  if (data.needs.length === 0) {
    gaps.push({ area: "maintenance_needs", severity: "alert", message: `Kunnossapitotarveselvitys vuosille ${data.year}–${data.year + 5} puuttuu.` });
  }
  return gaps;
}

/** Rivit, joita ei ole vielä ilmoitettu HTJ:hin, lajeittain. */
export function unsubmittedRows(data: Htj2Data): Record<HtjSubmissionKind, { id: string }[]> {
  return {
    charges: data.charges.filter((c) => c.htj_charge_type && !c.htj_submitted_at),
    loans: data.loans.filter((l) => !l.htj_submitted_at && isOpenLoan(l)),
    loan_shares: data.loanShares.filter((s) => !s.htj_submitted_at && !s.paid_off_on),
    maintenance_works: data.works.filter((w) => !w.htj_submitted_at && w.completed_year !== null),
    maintenance_needs: data.needs.filter((n) => !n.htj_submitted_at && n.status !== "done"),
  };
}

const n = (v: string | null) => (v === null ? null : Number(v));

/**
 * Ilmoituksen sisältö. TODO(MML-skeema): kenttänimet ovat eRapun omia ja
 * muunnetaan ylläpitorajapinnan muotoon `mml.ts`:ssä, kun OpenAPI-kuvaus on
 * saatavilla. Sisältö on yhtiötason tietoa; henkilötietoja ei ole.
 */
export function buildPayload(kind: HtjSubmissionKind, data: Htj2Data): { businessId: string; items: Record<string, unknown>[] } {
  const rows = new Set(unsubmittedRows(data)[kind].map((r) => r.id));
  const loanById = new Map(data.loans.map((l) => [l.id, l]));
  let items: Record<string, unknown>[] = [];
  switch (kind) {
    case "charges":
      items = data.charges.filter((c) => rows.has(c.id)).map((c) => ({
        id: c.id, htjChargeType: c.htj_charge_type, unitPrice: Number(c.unit_price), unit: CHARGE_BASIS_UNIT[c.basis] ?? c.basis,
        startsOn: c.starts_on, endsOn: c.ends_on, decidedOn: c.decided_on,
      }));
      break;
    case "loans":
      items = data.loans.filter((l) => rows.has(l.id)).map((l) => ({
        id: l.id, name: l.name, lender: l.lender, principalEur: Number(l.principal_eur), drawnOn: l.drawn_on, dueOn: l.due_on,
        interestTerms: l.interest_terms, undrawnEur: Number(l.undrawn_eur), balanceEur: n(l.balance_eur), balanceDate: l.balance_date, allocated: l.allocated,
      }));
      break;
    case "loan_shares":
      items = data.loanShares.filter((s) => rows.has(s.id)).map((s) => ({
        id: s.id, loanId: s.loan_id, loanHtjId: loanById.get(s.loan_id)?.htj_id ?? null, unitLabel: s.unit_label, shareGroupHtjId: s.group_htj_id,
        originalEur: Number(s.original_eur), remainingEur: Number(s.remaining_eur), balanceDate: s.balance_date,
      }));
      break;
    case "maintenance_works":
      items = data.works.filter((w) => rows.has(w.id)).map((w) => ({
        id: w.id, project: w.project, workType: w.work_type, workTypeCode: WORK_TYPES.find((t) => t.label === w.work_type)?.htjCode ?? null,
        completedYear: w.completed_year, performedBy: w.performed_by, unitLabel: w.unit_label,
      }));
      break;
    case "maintenance_needs":
      items = data.needs.filter((x) => rows.has(x.id)).map((x) => ({
        id: x.id, plannedYear: x.planned_year, target: x.target, action: x.action, workType: x.work_type, affectsResidents: x.affects_residents,
      }));
      break;
  }
  return { businessId: data.company.business_id, items };
}

export type ReportState = "not_started" | "draft" | "sent" | "manual_done" | "rejected";

export const REPORT_STATE_LABEL: Record<ReportState, string> = {
  not_started: "Ei aloitettu",
  draft: "Luonnos",
  sent: "Lähetetty",
  manual_done: "Merkitty käsin tehdyksi",
  rejected: "Hylätty",
};

/** Yhtiön ilmoitusten kokonaistila jonon riveistä. */
export function reportState(subs: { status: string; created_at: string | Date }[]): ReportState {
  if (subs.length === 0) return "not_started";
  if (subs.some((s) => s.status === "draft" || s.status === "approved")) return "draft";
  const latest = [...subs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (latest.status === "manual_done") return "manual_done";
  if (latest.status === "rejected") return "rejected";
  return "sent";
}

export const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  draft: "Luonnos",
  approved: "Hyväksytty, odottaa lähetystä",
  sent: "Lähetetty",
  accepted: "HTJ vastaanotti",
  rejected: "HTJ hylkäsi",
  manual_done: "Ilmoitettu käsin",
};
