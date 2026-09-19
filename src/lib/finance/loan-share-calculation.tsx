/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf } from "@/documents/render";
import { LoanShareCalculation, type LoanShareCalculationData } from "@/documents/LoanShareCalculation";
import { formatDate, formatNames, formatShareRanges } from "@/documents/format";
import { formatReference } from "@/lib/validation/finnish";
import { FinanceError, getBillingSettings, loadChargeBases } from "./billing";
import { chargesForGroup } from "./charges";
import { monthPeriod } from "./dates";
import { LOAN_TYPE } from "./labels";
import { estimatedRemainingCents } from "./loans";
import { toCents } from "./money";
import { activeOn } from "./payers";
import { companyReference } from "./references";
import { centsToEur } from "./statements";

/**
 * Osakkaan lainaosuuslaskelma (PDF). Tiedot huoneiston lainaosuuksista
 * (er_loan_shares), kertasuorituksen arvio maksupäivälle ja maksuohje.
 * Tallennetaan huoneiston dokumentiksi; näkyvyys osakkaalle valitaan.
 */

const e = (cents: bigint) => `${centsToEur(cents)} €`;

export interface CalculationOptions {
  issuedOn: string;
  payOn: string;
  feeEur: string | null;
}

export async function loadLoanShareCalculation(tx: Sql, companyId: string, shareGroupId: string, opts: CalculationOptions): Promise<LoanShareCalculationData | null> {
  const [g] = await tx.query<{ unit_label: string; kind: string; area_m2: string | null; share_count: number; company_name: string; business_id: string; org_name: string }>(
    `select g.unit_label, g.kind, g.area_m2::text, g.share_count, c.name as company_name, c.business_id, o.name as org_name
       from er_share_groups g join er_housing_companies c on c.id = g.company_id join er_organizations o on o.id = c.organization_id
      where g.id = $1 and g.company_id = $2`,
    [shareGroupId, companyId],
  );
  if (!g) return null;
  const [ranges, owners, shares, settings, bases, seq] = await Promise.all([
    tx.query<{ first: number; last: number }>("select first_share as first, last_share as last from er_share_ranges where share_group_id = $1 order by first_share", [shareGroupId]),
    tx.query<{ display_name: string; starts_on: string | null; ends_on: string | null }>(
      "select p.display_name, o.starts_on::text, o.ends_on::text from er_ownerships o join er_parties p on p.id = o.party_id where o.share_group_id = $1 order by p.display_name",
      [shareGroupId],
    ),
    tx.query<{
      loan_name: string; lender: string | null; due_on: string | null; loan_type: string | null; interest_terms: string | null; allocated: boolean;
      original_eur: string; remaining_eur: string; balance_date: string; paid_off_on: string | null; paid_off_eur: string | null;
    }>(
      `select l.name as loan_name, l.lender, l.due_on::text, l.loan_type, l.interest_terms, l.allocated, s.original_eur::text, s.remaining_eur::text,
              s.balance_date::text, s.paid_off_on::text, s.paid_off_eur::text
         from er_loan_shares s join er_loans l on l.id = s.loan_id where s.share_group_id = $1 and l.company_id = $2 order by l.name`,
      [shareGroupId, companyId],
    ),
    getBillingSettings(tx, companyId),
    loadChargeBases(tx, companyId),
    tx.query<{ seq_no: number }>("select seq_no from er_billing_unit_numbers where share_group_id = $1", [shareGroupId]),
  ]);

  const monthly = chargesForGroup(bases, { id: shareGroupId, unit_label: g.unit_label, kind: g.kind, area_m2: g.area_m2, share_count: g.share_count }, monthPeriod(opts.issuedOn.slice(0, 7)))
    .lines.filter((l) => l.chargeType === "financing" || l.chargeType === "capital")
    .reduce((s, l) => s + l.amountCents, 0n);

  let total = 0n;
  let anyEstimated = false;
  const loans = shares.map((s) => {
    if (s.paid_off_on) {
      return {
        name: s.loan_name, details: "", original: e(toCents(s.original_eur)), remaining: "", balanceDate: s.balance_date, payAmount: "", estimated: false,
        paidOff: `Maksettu ${formatDate(s.paid_off_on)}${s.paid_off_eur ? `, ${e(toCents(s.paid_off_eur))}` : ""}`,
      };
    }
    const est = estimatedRemainingCents(toCents(s.remaining_eur), s.balance_date, opts.payOn, s.due_on);
    total += est.cents;
    anyEstimated ||= est.estimated;
    return {
      name: s.loan_name,
      details: [s.loan_type ? LOAN_TYPE[s.loan_type] : null, s.lender, s.due_on ? `erääntyy ${formatDate(s.due_on)}` : null, s.interest_terms].filter(Boolean).join(" · "),
      original: e(toCents(s.original_eur)),
      remaining: e(toCents(s.remaining_eur)),
      balanceDate: s.balance_date,
      payAmount: e(est.cents),
      estimated: est.estimated,
      paidOff: null,
    };
  });
  const fee = opts.feeEur ? toCents(opts.feeEur) : 0n;
  if (fee > 0n) total += fee;

  const reference = settings && seq[0] ? formatReference(companyReference(settings.company_number, seq[0].seq_no)) : null;
  const notes = [
    "Kertasuorituksella osakas maksaa huoneiston osuuden yhtiölainasta kerralla. Maksun jälkeen huoneistolta ei enää peritä rahoitusvastiketta tästä lainasta.",
    anyEstimated
      ? "* Arvio: saldopäivän osuudesta on vähennetty tasalyhennys maksupäivään mennessä. Lopullinen määrä vahvistetaan maksupäivän lainasaldosta; ota yhteys isännöitsijään ennen maksua."
      : "Osuus perustuu saldopäivän lainasaldoon. Varmista määrä isännöitsijältä ennen maksua.",
    "Kertasuorituksen ajankohdasta ja mahdollisista ehdoista päättää yhtiön hallitus.",
  ];
  return {
    organizationName: g.org_name,
    companyName: g.company_name,
    businessId: g.business_id,
    unitLabel: g.unit_label,
    shareCount: g.share_count,
    shareRanges: ranges.length ? formatShareRanges(ranges) : "",
    owners: formatNames(owners.filter((o) => activeOn(o, opts.issuedOn)).map((o) => o.display_name)),
    issuedOn: opts.issuedOn,
    payOn: opts.payOn,
    loans,
    monthlyFinancing: monthly > 0n ? e(monthly) : null,
    fee: fee > 0n ? e(fee) : null,
    total: e(total),
    payment: settings?.bank_iban ? { iban: settings.bank_iban.replace(/(.{4})/g, "$1 ").trim(), bic: settings.bank_bic, reference } : null,
    notes,
  };
}

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export async function generateLoanShareCalculation(
  run: Runner,
  opts: CalculationOptions & { companyId: string; shareGroupId: string; userId: string; visibleToOwners: boolean },
): Promise<string> {
  const loaded = await run(async (tx) => {
    const data = await loadLoanShareCalculation(tx, opts.companyId, opts.shareGroupId, opts);
    const [c] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [opts.companyId]);
    return data && c ? { data, organizationId: c.organization_id } : null;
  });
  if (!loaded) throw new FinanceError("Huoneistoa ei löytynyt.");
  if (loaded.data.loans.length === 0) throw new FinanceError("Huoneistolla ei ole lainaosuuksia. Laske ne ensin lainan sivulla.");
  const pdf = await renderDocumentPdf(<LoanShareCalculation data={loaded.data} />);
  const stored = await storeFile({
    organizationId: loaded.organizationId,
    companyId: opts.companyId,
    fileName: `lainaosuuslaskelma-${loaded.data.unitLabel.replace(/\s+/g, "")}-${opts.issuedOn}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
  });
  try {
    return await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility,
            year, subject_table, subject_id, uploaded_by)
         values ($1,$2,$3,'other',$4,$5,$6,$7,$8,$9,$10,$11,'er_share_groups',$3,$12) returning id`,
        [loaded.organizationId, opts.companyId, opts.shareGroupId, `Lainaosuuslaskelma, huoneisto ${loaded.data.unitLabel} (${formatDate(opts.issuedOn)})`,
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, opts.visibleToOwners ? "owners" : "internal",
          Number(opts.issuedOn.slice(0, 4)), opts.userId],
      );
      return doc.id;
    });
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}
