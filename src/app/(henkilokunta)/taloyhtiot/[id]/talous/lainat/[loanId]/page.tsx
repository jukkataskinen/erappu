import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, Field, Input, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, formatNumber } from "@/lib/format";
import { decimalInput } from "@/lib/finance/labels";
import { listLoans, listLoanShares, sumEur } from "@/lib/finance/queries";
import { recalcLoanShares, saveLoan, updateLoanShare } from "../../actions";

export const metadata = { title: "Laina" };

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string; loanId: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id, loanId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) notFound();
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const data = await ctx.run(async (tx) => {
    const loan = (await listLoans(tx, id)).find((l) => l.id === loanId);
    if (!loan) return null;
    return { loan, shares: await listLoanShares(tx, loanId) };
  });
  if (!data) notFound();
  const { loan, shares } = data;
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");
  const editable = canWrite && loan.source !== "htj";
  const totalShares = shares.reduce((s, x) => s + x.share_count, 0);
  const originalSum = sumEur(shares.map((s) => s.original_eur));
  const remainingSum = sumEur(shares.map((s) => s.remaining_eur));
  const balance = loan.balance_eur ?? loan.principal_eur;

  return (
    <>
      <CompanyHeader company={company} active="talous" sub={loan.name} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">{loan.name}</h2>
          {loan.allocated ? <Badge tone="info">Jaettava laina</Badge> : <Badge>Ei jaettava</Badge>}
        </div>
        <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
          Takaisin talouteen
        </LinkButton>
      </div>
      <FormError message={virhe} />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Panel>
          <SectionTitle>Lainan tiedot</SectionTitle>
          <form action={saveLoan} className="grid gap-3">
            <input type="hidden" name="company_id" value={id} />
            <input type="hidden" name="id" value={loan.id} />
            <Field label="Nimi" htmlFor="name">
              <Input id="name" name="name" defaultValue={loan.name} required disabled={!editable} />
            </Field>
            <Field label="Lainanantaja" htmlFor="lender">
              <Input id="lender" name="lender" defaultValue={loan.lender ?? ""} disabled={!editable} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pääoma (€)" htmlFor="principal_eur">
                <Input id="principal_eur" name="principal_eur" inputMode="decimal" defaultValue={decimalInput(loan.principal_eur)} required disabled={!editable} />
              </Field>
              <Field label="Nostamatta (€)" htmlFor="undrawn_eur">
                <Input id="undrawn_eur" name="undrawn_eur" inputMode="decimal" defaultValue={decimalInput(loan.undrawn_eur)} disabled={!editable} />
              </Field>
              <Field label="Saldo (€)" htmlFor="balance_eur">
                <Input id="balance_eur" name="balance_eur" inputMode="decimal" defaultValue={decimalInput(loan.balance_eur)} disabled={!editable} />
              </Field>
              <Field label="Saldo päivältä" htmlFor="balance_date">
                <Input id="balance_date" name="balance_date" type="date" defaultValue={loan.balance_date ?? ""} disabled={!editable} />
              </Field>
              <Field label="Nostettu" htmlFor="drawn_on">
                <Input id="drawn_on" name="drawn_on" type="date" defaultValue={loan.drawn_on ?? ""} disabled={!editable} />
              </Field>
              <Field label="Erääntyy" htmlFor="due_on">
                <Input id="due_on" name="due_on" type="date" defaultValue={loan.due_on ?? ""} disabled={!editable} />
              </Field>
            </div>
            <Field label="Korkoehdot" htmlFor="interest_terms">
              <Input id="interest_terms" name="interest_terms" defaultValue={loan.interest_terms ?? ""} disabled={!editable} />
            </Field>
            <Field label="Käyttötarkoitus" htmlFor="purpose">
              <Input id="purpose" name="purpose" defaultValue={loan.purpose ?? ""} disabled={!editable} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allocated" defaultChecked={loan.allocated} disabled={!editable} /> Jaettava laina (lainaosuudet osakeryhmille)
            </label>
            {editable ? (
              <div>
                <Button variant="secondary">Tallenna</Button>
              </div>
            ) : null}
          </form>
        </Panel>

        <div className="grid min-w-0 content-start gap-6">
          <Panel>
            <SectionTitle
              actions={
                canWrite && loan.allocated ? (
                  <form action={recalcLoanShares}>
                    <input type="hidden" name="company_id" value={id} />
                    <input type="hidden" name="loan_id" value={loan.id} />
                    <Button variant="secondary">{shares.length ? "Laske uudelleen osakkeiden suhteessa" : "Laske osakkeiden suhteessa"}</Button>
                  </form>
                ) : null
              }
            >
              Lainaosuudet
            </SectionTitle>
            <p className="mb-3 text-sm text-ink/65">
              Laskelma jakaa pääoman kaikille osakeryhmille ja saldon niille, jotka eivät ole maksaneet osuuttaan kertasuorituksena. Jäännössentit menevät suurimmille osakeryhmille, joten osuudet
              summautuvat täsmälleen. Kertasuorituksen tehneiden rivit säilyvät.
            </p>
            {shares.length > 0 && (sumEur([originalSum]) !== sumEur([loan.principal_eur]) || sumEur([remainingSum]) !== sumEur([balance])) ? (
              <div className="mb-3">
                <Notice tone="warn" title="Osuudet eivät täsmää lainaan">
                  Osuudet yhteensä {formatEur(originalSum)} / jäljellä {formatEur(remainingSum)}, lainan pääoma {formatEur(loan.principal_eur)} / saldo {formatEur(balance)}.
                </Notice>
              </div>
            ) : null}
            {shares.length === 0 ? (
              <p className="text-sm text-ink/65">Lainaosuuksia ei ole laskettu.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Huoneisto</Th>
                    <Th numeric>Osakkeet</Th>
                    <Th>Alkuperäinen / jäljellä (€)</Th>
                    <Th>Saldopäivä / kertasuoritus</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {shares.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-semibold">
                        {s.unit_label}
                        {s.paid_off_on ? (
                          <span className="mt-1 block">
                            <Badge tone="ok">Kertasuoritus {formatDate(s.paid_off_on)}</Badge>
                          </span>
                        ) : null}
                      </Td>
                      <Td numeric>
                        {formatNumber(s.share_count)}
                        <span className="block text-xs text-ink/50">{totalShares ? `${formatNumber((s.share_count / totalShares) * 100)} %` : ""}</span>
                      </Td>
                      <Td>
                        {canWrite ? (
                          <form id={`ls-${s.id}`} action={updateLoanShare} className="grid gap-1.5">
                            <input type="hidden" name="company_id" value={id} />
                            <input type="hidden" name="loan_id" value={loan.id} />
                            <input type="hidden" name="id" value={s.id} />
                            <input aria-label="Alkuperäinen osuus" name="original_eur" inputMode="decimal" defaultValue={decimalInput(s.original_eur)} className="min-h-9 rounded-lg border border-line bg-paper px-2.5 text-sm text-ink focus:border-sky focus:outline-none w-32" />
                            <input aria-label="Jäljellä oleva osuus" name="remaining_eur" inputMode="decimal" defaultValue={decimalInput(s.remaining_eur)} className="min-h-9 rounded-lg border border-line bg-paper px-2.5 text-sm text-ink focus:border-sky focus:outline-none w-32" />
                          </form>
                        ) : (
                          <span className="tabular">
                            {formatEur(s.original_eur)} / {formatEur(s.remaining_eur)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {canWrite ? (
                          <div className="grid gap-1.5">
                            <input form={`ls-${s.id}`} aria-label="Saldopäivä" name="balance_date" type="date" defaultValue={s.balance_date} className="min-h-9 rounded-lg border border-line bg-paper px-2.5 text-sm text-ink focus:border-sky focus:outline-none w-40" />
                            <input form={`ls-${s.id}`} aria-label="Kertasuorituksen päivä" name="paid_off_on" type="date" defaultValue={s.paid_off_on ?? ""} className="min-h-9 rounded-lg border border-line bg-paper px-2.5 text-sm text-ink focus:border-sky focus:outline-none w-40" />
                          </div>
                        ) : (
                          formatDate(s.balance_date)
                        )}
                      </Td>
                      <Td>{canWrite ? <Button form={`ls-${s.id}`} variant="ghost" className="min-h-9 px-2 text-xs">Tallenna</Button> : null}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Td className="font-semibold">Yhteensä</Td>
                    <Td numeric>{formatNumber(totalShares)}</Td>
                    <Td className="tabular font-semibold">
                      {formatEur(originalSum)} / {formatEur(remainingSum)}
                    </Td>
                    <Td />
                    <Td />
                  </tr>
                </tfoot>
              </Table>
            )}
            {canWrite && shares.length > 0 ? (
              <p className="mt-3 text-xs text-ink/55">Kertasuoritus: anna suorituspäivä ja tallenna. Jäljellä oleva osuus nollautuu, eikä osakeryhmä saa rahoitusvastiketta tästä lainasta.</p>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
