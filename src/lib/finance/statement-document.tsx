/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf } from "@/documents/render";
import { LoanStatements, type LoanStatementsData } from "@/documents/LoanStatements";
import { formatDate } from "@/documents/format";
import { FinanceError } from "./billing";
import { toCents } from "./money";
import { loadStatementData, type StatementData } from "./statement-data";
import { centsToEur, chargeUsageText } from "./statements";

/**
 * Vastikkeiden käytön ja lainaosuuslaskelmien PDF tilinpäätöksen liitteeksi.
 * Tallennetaan yhtiön dokumentiksi hallituksen näkyvyydellä.
 */

const e = (cents: bigint) => `${centsToEur(cents)} €`;

export function buildLoanStatementsData(d: StatementData, organizationName: string, issuedOn: string): LoanStatementsData {
  const f = d.result.financing;
  const m = d.result.maintenance;
  return {
    organizationName,
    companyName: d.company.name,
    businessId: d.company.businessId,
    periodStart: d.period.start,
    periodEnd: d.period.end,
    issuedOn,
    maintenance: m
      ? [
          { label: "Hoitotuotot (hoitovastikkeet ja muut hoitotuotot)", value: e(m.incomeCents) },
          { label: "Hoitokulut", value: e(-m.expensesCents) },
          { label: m.resultCents >= 0n ? "Hoidon ylijäämä" : "Hoidon alijäämä", value: e(m.resultCents), strong: true },
        ]
      : null,
    financing: f
      ? [
          { label: "Rahoitusvastikkeet", value: e(f.incomeCents) },
          ...(f.lumpSumCents > 0n ? [{ label: "Lainaosuuksien kertasuoritukset", value: e(f.lumpSumCents) }] : []),
          { label: "Lainojen lyhennykset", value: e(-f.amortizationCents) },
          ...(f.lumpSumUsedCents > 0n ? [{ label: "Kertasuorituksilla maksetut lainaosuudet", value: e(-f.lumpSumUsedCents) }] : []),
          ...(f.interestCents > 0n ? [{ label: "Lainojen korot", value: e(-f.interestCents) }] : []),
          { label: f.resultCents >= 0n ? "Tilikauden ylijäämä" : "Tilikauden alijäämä", value: e(f.resultCents), strong: true },
          { label: "Edellisiltä tilikausilta siirtyneet käyttämättömät rahoitusvastikkeet", value: e(f.carriedInCents) },
          { label: `Käyttämättömät rahoitusvastikkeet ${formatDate(d.period.end)}`, value: e(f.carriedOutCents), strong: true },
        ]
      : null,
    usageText: chargeUsageText(d.result, d.period),
    loans: d.loans
      .filter((l) => l.saved && l.allocated && l.statement)
      .map((l) => {
        const s = l.statement!;
        return {
          name: l.name,
          details: [l.lender, l.dueOn ? `erääntyy ${formatDate(l.dueOn)}` : null].filter(Boolean).join(" · "),
          summary: [
            { label: `Saldo ${formatDate(d.period.start)}`, value: e(toCents(l.values.openingBalanceEur)) },
            { label: "Lyhennykset", value: e(toCents(l.values.amortizationEur)) },
            { label: "Kertasuoritukset", value: e(toCents(l.values.lumpSumEur)) },
            ...(toCents(l.values.drawnEur) > 0n ? [{ label: "Nostot", value: e(toCents(l.values.drawnEur)) }] : []),
            { label: "Korot", value: e(toCents(l.values.interestEur)) },
            { label: `Saldo ${formatDate(d.period.end)}`, value: e(toCents(l.values.closingBalanceEur)) },
          ],
          rows: s.rows.map((r) => ({
            unit: r.unitLabel,
            shares: r.shareCount,
            opening: r.paidBefore ? "–" : e(r.openingCents),
            lumpSum: r.lumpSumCents > 0n ? e(r.lumpSumCents) : "",
            amortization: r.paidBefore ? "–" : e(r.amortizationCents),
            closing: r.paidBefore ? "–" : e(r.closingCents),
            note: r.paidBefore ? `maksettu ${formatDate(r.paidOffOn)}` : r.lumpSumCents > 0n ? `kertasuoritus ${formatDate(r.paidOffOn)}` : "",
          })),
          totals: { opening: e(s.totals.openingCents), lumpSum: e(s.totals.lumpSumCents), amortization: e(s.totals.amortizationCents), closing: e(s.totals.closingCents) },
          warnings: s.warnings,
        };
      }),
  };
}

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export async function generateStatementDocument(run: Runner, opts: { companyId: string; endYear: number; userId: string; issuedOn: string }): Promise<string> {
  const loaded = await run(async (tx) => {
    const data = await loadStatementData(tx, opts.companyId, opts.endYear);
    if (!data) return null;
    const [org] = await tx.query<{ name: string }>("select name from er_organizations where id = $1", [data.company.organizationId]);
    return { data, orgName: org?.name ?? "" };
  });
  if (!loaded) throw new FinanceError("Yhtiötä ei löytynyt.");
  const { data } = loaded;
  if (!data.charges.saved && !data.loans.some((l) => l.saved)) throw new FinanceError("Tallenna ensin lainojen tilikauden luvut tai rahoitusvastikelaskelma.");

  const pdf = await renderDocumentPdf(<LoanStatements data={buildLoanStatementsData(data, loaded.orgName, opts.issuedOn)} />);
  const stored = await storeFile({
    organizationId: data.company.organizationId,
    companyId: opts.companyId,
    fileName: `vastikkeiden-kaytto-ja-lainaosuudet-${data.period.end.slice(0, 4)}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf.bytes),
  });
  try {
    return await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility,
            year, subject_table, subject_id, uploaded_by)
         values ($1,$2,'other',$3,$4,$5,$6,$7,$8,'board',$9,'er_housing_companies',$2,$10) returning id`,
        [data.company.organizationId, opts.companyId, `Vastikkeiden käyttö ja lainaosuuslaskelmat ${formatDate(data.period.start)}–${formatDate(data.period.end)}`,
          stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, Number(data.period.end.slice(0, 4)), opts.userId],
      );
      return doc.id;
    });
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}
