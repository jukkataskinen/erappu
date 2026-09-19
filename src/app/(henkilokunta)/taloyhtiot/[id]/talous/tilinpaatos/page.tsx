import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, Field, Input, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, formatNumber, isoDateHelsinki } from "@/lib/format";
import { decimalInput } from "@/lib/finance/labels";
import { centsToDecimal } from "@/lib/finance/money";
import { loadStatementData, type StatementLoan } from "@/lib/finance/statement-data";
import { chargeUsageText } from "@/lib/finance/statements";
import { applyClosingBalancesAction, generateStatementPdfAction, saveChargeStatementAction, saveLoanPeriodAction } from "./actions";

export const metadata = { title: "Tilinpäätöksen laskelmat" };

const eur = (cents: bigint) => formatEur(centsToDecimal(cents));

/**
 * Tilinpäätöksen liitteet: vastikkeiden käyttö (jälkilaskelma, AOYL 10:5 §
 * 1 kohta) ja lainaosuuslaskelmat. Luvut kirjanpidosta ja pankin
 * saldotiedoista, eRappu jakaa ne osakeryhmille ja laatii PDF:n.
 */
export default async function StatementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; saldot?: string; asiakirja?: string }>;
}) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;
  const thisYear = Number(isoDateHelsinki().slice(0, 4));
  const requested = Number(sp.vuosi);
  const endYear = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : thisYear - 1;
  const data = await ctx.run((tx) => loadStatementData(tx, id, endYear));
  if (!data) return null;
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");
  const { period, charges, result } = data;
  const f = result.financing;
  const m = result.maintenance;
  const usage = chargeUsageText(result, period);
  const hidden = (
    <>
      <input type="hidden" name="company_id" value={id} />
      <input type="hidden" name="vuosi" value={endYear} />
    </>
  );
  const allocated = data.loans.filter((l) => l.allocated);
  const other = data.loans.filter((l) => !l.allocated);

  return (
    <>
      <CompanyHeader company={company} active="talous" sub="Tilinpäätöksen laskelmat" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">
            Tilikausi {formatDate(period.start)}–{formatDate(period.end)}
          </h2>
          <div className="flex gap-1 text-sm">
            <Link className="rounded-lg px-2 py-1 hover:bg-cloud" href={`?vuosi=${endYear - 1}`}>
              ← {endYear - 1}
            </Link>
            {endYear < thisYear ? (
              <Link className="rounded-lg px-2 py-1 hover:bg-cloud" href={`?vuosi=${endYear + 1}`}>
                {endYear + 1} →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
            Takaisin talouteen
          </LinkButton>
          {canWrite ? (
            <form action={generateStatementPdfAction}>
              {hidden}
              <Button>Luo PDF tilinpäätöksen liitteeksi</Button>
            </form>
          ) : null}
        </div>
      </div>
      <FormError message={sp.virhe} />
      {sp.asiakirja && /^[0-9a-f-]{36}$/i.test(sp.asiakirja) ? (
        <div className="mb-4">
          <Notice tone="ok" title="PDF tallennettu yhtiön dokumentteihin">
            <a className="text-sky underline" href={`/api/dokumentit/${sp.asiakirja}`} target="_blank" rel="noreferrer">
              Avaa PDF
            </a>{" "}
            (näkyy myös hallitukselle portaalissa).
          </Notice>
        </div>
      ) : null}
      {sp.saldot !== undefined ? (
        <div className="mb-4">
          <Notice tone="ok">Lainojen saldot päivitetty {formatDate(period.end)} tilanteeseen ({sp.saldot} lainaa), ja lainaosuudet laskettu uudelleen.</Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Panel id="jalkilaskelma">
          <SectionTitle>Vastikkeiden käyttö (jälkilaskelma)</SectionTitle>
          <p className="mb-3 text-sm text-ink/65">
            Asunto-osakeyhtiölain 10 luvun 5 §:n mukaan toimintakertomuksessa on kerrottava, miten yhtiövastikkeet on käytetty, jos vastiketta peritään eri tarkoituksiin
            eri perustein. Luvut tilinpäätöksen tuloslaskelmasta ja taseesta.
          </p>
          {canWrite ? (
            <form action={saveChargeStatementAction} className="grid gap-3">
              {hidden}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Rahoitusvastikkeet (€)"
                  htmlFor="financing_income_eur"
                  hint={data.chargePrefill.financingIncome ? `eRapun laskutuksessa ${formatEur(data.chargePrefill.financingIncome)}` : "Tuloslaskelman rahoitus- tai pääomavastikkeet"}
                >
                  <Input id="financing_income_eur" name="financing_income_eur" inputMode="decimal" defaultValue={decimalInput(charges.financingIncomeEur)} />
                </Field>
                <Field
                  label="Siirtyneet käyttämättömät rahoitusvastikkeet (€)"
                  htmlFor="carried_in_eur"
                  hint={data.chargePrefill.carriedIn ? `Edellinen tilikausi: ${formatEur(data.chargePrefill.carriedIn)}` : "Taseen siirtovelka tilikauden alussa"}
                >
                  <Input id="carried_in_eur" name="carried_in_eur" inputMode="decimal" defaultValue={decimalInput(charges.carriedInEur)} />
                </Field>
                <Field label="Hoitotuotot (€)" htmlFor="maintenance_income_eur" hint="Valinnainen: hoitovastikkeet ja muut hoitotuotot">
                  <Input id="maintenance_income_eur" name="maintenance_income_eur" inputMode="decimal" defaultValue={decimalInput(charges.maintenanceIncomeEur)} />
                </Field>
                <Field label="Hoitokulut (€)" htmlFor="maintenance_expenses_eur" hint="Valinnainen">
                  <Input id="maintenance_expenses_eur" name="maintenance_expenses_eur" inputMode="decimal" defaultValue={decimalInput(charges.maintenanceExpensesEur)} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="interest_from_financing" defaultChecked={charges.interestFromFinancing} /> Lainojen korot katetaan rahoitusvastikkeella
              </label>
              <Field label="Lisätieto" htmlFor="charge_note">
                <Input id="charge_note" name="note" defaultValue={charges.note ?? ""} />
              </Field>
              <div>
                <Button variant="secondary">{charges.saved ? "Tallenna" : "Tallenna jälkilaskelma"}</Button>
              </div>
            </form>
          ) : null}

          {m || f ? (
            <div className="mt-5 grid gap-4 border-t border-line pt-4 text-sm">
              {m ? (
                <dl className="grid gap-1">
                  <Row label="Hoitotuotot" value={eur(m.incomeCents)} />
                  <Row label="Hoitokulut" value={eur(-m.expensesCents)} />
                  <Row label={m.resultCents >= 0n ? "Hoidon ylijäämä" : "Hoidon alijäämä"} value={eur(m.resultCents)} strong />
                </dl>
              ) : null}
              {f ? (
                <dl className="grid gap-1">
                  <Row label="Rahoitusvastikkeet" value={eur(f.incomeCents)} />
                  {f.lumpSumCents > 0n ? <Row label="Lainaosuuksien kertasuoritukset" value={eur(f.lumpSumCents)} /> : null}
                  <Row label="Lainojen lyhennykset" value={eur(-f.amortizationCents)} />
                  {f.lumpSumUsedCents > 0n ? <Row label="Kertasuorituksilla maksetut lainaosuudet" value={eur(-f.lumpSumUsedCents)} /> : null}
                  {f.interestCents > 0n ? <Row label="Lainojen korot" value={eur(-f.interestCents)} /> : null}
                  <Row label={f.resultCents >= 0n ? "Tilikauden ylijäämä" : "Tilikauden alijäämä"} value={eur(f.resultCents)} strong />
                  <Row label="Siirtyneet edellisiltä tilikausilta" value={eur(f.carriedInCents)} />
                  <Row label={`Käyttämättömät rahoitusvastikkeet ${formatDate(period.end)}`} value={eur(f.carriedOutCents)} strong />
                </dl>
              ) : null}
              {usage.length ? (
                <div className="rounded-xl bg-cloud/60 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">Toimintakertomukseen</p>
                  {usage.map((t, i) => (
                    <p key={i} className="mt-1">
                      {t}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <div className="grid min-w-0 content-start gap-6">
          {allocated.length === 0 ? (
            <Panel>
              <SectionTitle>Lainaosuuslaskelmat</SectionTitle>
              <p className="text-sm text-ink/65">Yhtiöllä ei ole jaettavia lainoja tällä tilikaudella.</p>
            </Panel>
          ) : null}
          {allocated.map((l) => (
            <LoanPanel key={l.id} companyId={id} endYear={endYear} loan={l} canWrite={canWrite} periodStart={period.start} periodEnd={period.end} />
          ))}
          {other.length ? (
            <Panel>
              <SectionTitle>Muut lainat</SectionTitle>
              <p className="mb-2 text-sm text-ink/65">Näitä lainoja ei jaeta osakeryhmille, joten niistä ei tehdä lainaosuuslaskelmaa.</p>
              <ul className="text-sm">
                {other.map((l) => (
                  <li key={l.id}>{l.name}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {canWrite && data.loans.some((l) => l.saved) ? (
            <Panel>
              <SectionTitle>Saldot rekisteriin</SectionTitle>
              <p className="mb-3 text-sm text-ink/65">
                Vie tilikauden loppusaldot lainoille ja laske lainaosuudet uudelleen. Isännöitsijäntodistus ja osakkaiden portaali näyttävät sen jälkeen {formatDate(period.end)}{" "}
                tilanteen. Uudempaa saldoa ei korvata.
              </p>
              <form action={applyClosingBalancesAction}>
                {hidden}
                <Button variant="secondary">Päivitä lainojen saldot ja osuudet</Button>
              </form>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-1 font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular whitespace-nowrap">{value}</dd>
    </div>
  );
}

function LoanPanel({ companyId, endYear, loan, canWrite, periodStart, periodEnd }: { companyId: string; endYear: number; loan: StatementLoan; canWrite: boolean; periodStart: string; periodEnd: string }) {
  const v = loan.values;
  const s = loan.statement;
  const field = (name: keyof typeof v, label: string, formName: string, hint?: string) => (
    <Field label={label} htmlFor={`${formName}-${loan.id}`} hint={hint}>
      <Input id={`${formName}-${loan.id}`} name={formName} inputMode="decimal" defaultValue={decimalInput(v[name])} disabled={!canWrite} />
    </Field>
  );
  return (
    <Panel id={`laina-${loan.id}`}>
      <SectionTitle
        actions={
          <Link href={`/taloyhtiot/${companyId}/talous/lainat/${loan.id}`} className="text-sm text-sky">
            Lainan tiedot
          </Link>
        }
      >
        {loan.name} {loan.saved ? null : <Badge tone="warn">Ei tallennettu</Badge>}
      </SectionTitle>
      <form action={saveLoanPeriodAction} className="grid gap-3">
        <input type="hidden" name="company_id" value={companyId} />
        <input type="hidden" name="vuosi" value={endYear} />
        <input type="hidden" name="loan_id" value={loan.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          {field("openingBalanceEur", `Saldo ${formatDate(periodStart)} (€)`, "opening_balance_eur", loan.prefill.opening ? "Edellisen tilikauden loppusaldo" : undefined)}
          {field("amortizationEur", "Lyhennykset (€)", "amortization_eur", "Maksuohjelman mukaiset")}
          {field("lumpSumEur", "Kertasuoritukset (€)", "lump_sum_eur", loan.prefill.lumpSum ? `Lainaosuuksista ${formatEur(loan.prefill.lumpSum)}` : undefined)}
          {field("drawnEur", "Nostot (€)", "drawn_eur")}
          {field("interestEur", "Korot (€)", "interest_eur")}
          {field("closingBalanceEur", `Saldo ${formatDate(periodEnd)} (€)`, "closing_balance_eur", "Pankin saldotodistus")}
        </div>
        <Field label="Lisätieto" htmlFor={`note-${loan.id}`}>
          <Input id={`note-${loan.id}`} name="note" defaultValue={loan.note ?? ""} disabled={!canWrite} />
        </Field>
        {canWrite ? (
          <div>
            <Button variant="secondary">Tallenna ja laske osuudet</Button>
          </div>
        ) : null}
      </form>
      {s ? (
        <div className="mt-5 border-t border-line pt-4">
          {s.warnings.length ? (
            <div className="mb-3">
              <Notice tone="warn" title="Tarkistettavaa">
                <ul className="list-disc pl-5">
                  {s.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>Huoneisto</Th>
                <Th numeric>Osakkeet</Th>
                <Th numeric>Osuus {formatDate(periodStart)}</Th>
                <Th numeric>Kertasuoritus</Th>
                <Th numeric>Lyhennys</Th>
                <Th numeric>Osuus {formatDate(periodEnd)}</Th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.shareGroupId}>
                  <Td className="font-semibold">
                    {r.unitLabel}
                    {r.paidBefore ? <span className="block text-xs font-normal text-ink/55">maksettu {formatDate(r.paidOffOn)}</span> : null}
                  </Td>
                  <Td numeric>{formatNumber(r.shareCount)}</Td>
                  <Td numeric>{r.paidBefore ? "–" : eur(r.openingCents)}</Td>
                  <Td numeric>
                    {r.lumpSumCents > 0n ? eur(r.lumpSumCents) : ""}
                    {r.lumpSumEstimated ? <span className="block text-xs text-coral">määrä puuttuu</span> : null}
                  </Td>
                  <Td numeric>{r.paidBefore ? "–" : eur(r.amortizationCents)}</Td>
                  <Td numeric>{r.paidBefore ? "–" : eur(r.closingCents)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td className="font-semibold">Yhteensä</Td>
                <Td />
                <Td numeric className="font-semibold">{eur(s.totals.openingCents)}</Td>
                <Td numeric className="font-semibold">{eur(s.totals.lumpSumCents)}</Td>
                <Td numeric className="font-semibold">{eur(s.totals.amortizationCents)}</Td>
                <Td numeric className="font-semibold">{eur(s.totals.closingCents)}</Td>
              </tr>
            </tfoot>
          </Table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink/60">Tallenna tilikauden luvut, niin osuudet lasketaan huoneistoittain.</p>
      )}
    </Panel>
  );
}
