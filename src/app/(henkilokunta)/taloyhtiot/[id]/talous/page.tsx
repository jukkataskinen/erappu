import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, SectionTitle, Select, Stat, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatEur, isoDateHelsinki } from "@/lib/format";
import { formatReference } from "@/lib/validation/finnish";
import { isEffectiveOn } from "@/lib/finance/charges";
import { BASIS, CHARGE_TYPE, RUN_STATUS, formatPrice, trimDecimal, UNIT_KIND } from "@/lib/finance/labels";
import { accrualCents, getBillingSettings, listImports, listLoans, listRuns, listUnitFinance, loadChargeBases, maintenanceRate, sumEur } from "@/lib/finance/queries";
import { loadBillableGroups } from "@/lib/finance/billing";
import { monthPeriod } from "@/lib/finance/dates";
import { centsToDecimal } from "@/lib/finance/money";
import { addBasis, createRun, importPayments, saveBillingSettings, saveLoan } from "./actions";

export const metadata = { title: "Talous" };

export default async function CompanyFinancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const today = isoDateHelsinki();

  const data = await ctx.run(async (tx) => {
    const settings = await getBillingSettings(tx, id);
    const bases = await loadChargeBases(tx, id);
    const [loans, runs, imports, units, groups] = await Promise.all([
      listLoans(tx, id),
      listRuns(tx, id, 12),
      listImports(tx, id, 5),
      listUnitFinance(tx, id, today, settings, bases),
      loadBillableGroups(tx, id, today),
    ]);
    return { settings, bases, loans, runs, imports, units, groups };
  });
  const { settings, bases, loans, runs, imports, units, groups } = data;
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");

  const rate = maintenanceRate(bases, today);
  const month = today.slice(0, 7);
  const accrual = centsToDecimal(accrualCents(bases, groups, monthPeriod(month)));
  const loansTotal = sumEur(loans.map((l) => l.balance_eur ?? l.principal_eur));
  const withStatus = units.filter((u) => u.as_of);
  const asOf = withStatus.map((u) => u.as_of!).sort().at(-1) ?? null;
  const openTotal = sumEur(withStatus.map((u) => u.open_eur));
  const overdueTotal = sumEur(withStatus.map((u) => u.overdue_eur));
  const currentBases = bases.filter((b) => isEffectiveOn(b, today) || b.starts_on > today);
  const pastBases = bases.filter((b) => !currentBases.includes(b));
  const currentRun = runs.find((r) => r.period_start.startsWith(month) && r.status !== "cancelled");

  return (
    <>
      <CompanyHeader company={company} active="talous" />
      <FormError message={virhe} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Hoitovastike" value={rate ? `${formatPrice(rate)} €/m²/kk` : "–"} />
        <Stat label={`Vastikekertymä ${Number(month.slice(5))}/${month.slice(0, 4)}`} value={formatEur(accrual)} />
        <Stat label="Lainat yhteensä" value={formatEur(loansTotal)} />
        <Stat
          label={asOf ? `Avoimet saatavat ${formatDate(asOf)}` : "Avoimet saatavat"}
          value={asOf ? formatEur(openTotal) : "Ei tuotu"}
          tone={asOf && Number(overdueTotal) > 0 ? "alert" : undefined}
        />
      </div>

      {!settings ? (
        <div className="mt-6">
          <Notice tone="warn" title="Laskutusasetukset puuttuvat">
            Anna yhtiön numero, eräpäivä ja tilinumero. Yhtiön numerosta muodostuvat huoneistojen vastikeviitteet.
          </Notice>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel>
            <SectionTitle>Laskutusajot</SectionTitle>
            {canWrite ? (
              <form action={createRun} className="mb-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="company_id" value={id} />
                <Field label="Kuukausi" htmlFor="month">
                  <Input id="month" name="month" type="month" defaultValue={currentRun ? nextMonth(month) : month} required className="w-44" />
                </Field>
                <label className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm">
                  <input type="checkbox" name="loan_financing" /> Rahoitusvastike lainaosuuksista
                </label>
                <Button variant="secondary" disabled={!settings}>
                  Luo laskutusajo
                </Button>
              </form>
            ) : null}
            {runs.length === 0 ? (
              <p className="text-sm text-ink/65">Laskutusajoja ei ole vielä tehty.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Kausi</Th>
                    <Th>Tila</Th>
                    <Th numeric>Rivejä</Th>
                    <Th numeric>Yhteensä</Th>
                    <Th>Luotu</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="hover:bg-cloud/50">
                      <Td>
                        <Link href={`/taloyhtiot/${id}/talous/ajot/${r.id}`} className="font-semibold hover:text-sky">
                          {Number(r.period_start.slice(5, 7))}/{r.period_start.slice(0, 4)}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                      </Td>
                      <Td numeric>{r.totals.line_count ?? "–"}</Td>
                      <Td numeric>{formatEur(r.totals.total_eur)}</Td>
                      <Td>{formatDateTime(r.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink/55">
              Rahoitusvastike lainaosuuksista lasketaan tasalyhenteisenä ilman korkoa (jäljellä oleva osuus / kuukaudet lainan eräpäivään). Älä valitse, jos rahoitusvastike on jo vastikeperusteena.
            </p>
          </Panel>

          <Panel>
            <SectionTitle>Vastikeperusteet</SectionTitle>
            {bases.length === 0 ? (
              <p className="text-sm text-ink/65">Vastikeperusteita ei ole kirjattu.</p>
            ) : (
              <BasisTable rows={currentBases} today={today} />
            )}
            {pastBases.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink/70">Päättyneet perusteet ({pastBases.length})</summary>
                <div className="mt-3">
                  <BasisTable rows={pastBases} today={today} />
                </div>
              </details>
            ) : null}

            {canWrite ? (
              <form action={addBasis} className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={id} />
                <p className="text-sm text-ink/65 sm:col-span-2">
                  Uusi peruste päättää saman vastikkeen edellisen perusteen automaattisesti alkupäivää edeltävänä päivänä.
                </p>
                <Field label="Vastikelaji" htmlFor="charge_type">
                  <Select id="charge_type" name="charge_type" defaultValue="maintenance">
                    {Object.entries(CHARGE_TYPE).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Peruste" htmlFor="basis">
                  <Select id="basis" name="basis" defaultValue="area_m2">
                    <option value="area_m2">€/m²/kk</option>
                    <option value="share">€/osake/kk</option>
                    <option value="unit">€/kpl/kk</option>
                    <option value="person">€/henkilö/kk</option>
                    <option value="meter">Mittarin mukaan</option>
                    <option value="fixed">Kiinteä €/kk</option>
                  </Select>
                </Field>
                <Field label="Yksikköhinta (€)" htmlFor="unit_price" hint="Enintään neljä desimaalia, esim. 3,15">
                  <Input id="unit_price" name="unit_price" inputMode="decimal" required />
                </Field>
                <Field label="ALV %" htmlFor="vat_percent" hint="Vastikkeet ovat yleensä arvonlisäverottomia">
                  <Input id="vat_percent" name="vat_percent" inputMode="decimal" defaultValue="0" />
                </Field>
                <Field label="Voimassa alkaen" htmlFor="starts_on">
                  <Input id="starts_on" name="starts_on" type="date" required />
                </Field>
                <Field label="Päätöspäivä" htmlFor="decided_on">
                  <Input id="decided_on" name="decided_on" type="date" />
                </Field>
                <Field label="Nimi laskulla" htmlFor="label" hint="Tyhjä = vastikelajin nimi">
                  <Input id="label" name="label" />
                </Field>
                <Field label="Päätös" htmlFor="decision_note" hint="Esim. varsinainen yhtiökokous 20.5.2026, § 9">
                  <Input id="decision_note" name="decision_note" />
                </Field>
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-semibold">Koskee huoneistotyyppejä</legend>
                  <p className="text-xs text-ink/55">Jätä kaikki valitsematta, jos peruste koskee kaikkia osakeryhmiä.</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {Object.entries(UNIT_KIND).map(([k, v]) => (
                      <label key={k} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="applies_to_kinds" value={k} /> {v}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="sm:col-span-2">
                  <Button variant="secondary">Lisää peruste</Button>
                </div>
              </form>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Huoneistot</SectionTitle>
            {units.length === 0 ? (
              <EmptyState title="Ei osakeryhmiä">Lisää huoneistot rekisteriin ennen laskutusta.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Huoneisto</Th>
                    <Th numeric>m²</Th>
                    <Th>Viite</Th>
                    <Th numeric>Vastike/kk</Th>
                    <Th numeric>Avoin</Th>
                    <Th numeric>Erääntynyt</Th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="hover:bg-cloud/50">
                      <Td>
                        <Link href={`/taloyhtiot/${id}/talous/huoneisto/${u.id}`} className="font-semibold hover:text-sky">
                          {u.unit_label}
                        </Link>
                        <p className="text-xs text-ink/55">{UNIT_KIND[u.kind] ?? u.kind}</p>
                      </Td>
                      <Td numeric>{trimDecimal(u.area_m2)}</Td>
                      <Td className="tabular whitespace-nowrap">{u.reference ? formatReference(u.reference) : <span className="text-ink/45">ei vielä</span>}</Td>
                      <Td numeric>{formatEur(u.monthly_eur)}</Td>
                      <Td numeric>{u.as_of ? formatEur(u.open_eur) : "–"}</Td>
                      <Td numeric className={Number(u.overdue_eur ?? 0) > 0 ? "font-semibold text-coral" : undefined}>
                        {u.as_of ? formatEur(u.overdue_eur) : "–"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink/55">Viite muodostuu ensimmäisessä laskutusajossa tai maksutilanteen tuonnissa, ja se pysyy samana omistajan vaihtuessa.</p>
          </Panel>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Panel>
            <SectionTitle>Maksutilanne</SectionTitle>
            {asOf ? (
              <p className="mb-3 text-sm">
                Tilanne {formatDate(asOf)}: avoinna <strong>{formatEur(openTotal)}</strong>, josta erääntynyttä{" "}
                <strong className={Number(overdueTotal) > 0 ? "text-coral" : undefined}>{formatEur(overdueTotal)}</strong>.
              </p>
            ) : (
              <p className="mb-3 text-sm text-ink/65">Maksutilannetta ei ole tuotu kirjanpidosta.</p>
            )}
            {canWrite ? (
              <form action={importPayments} className="grid gap-3">
                <input type="hidden" name="company_id" value={id} />
                <Field label="Reskontraraportti (CSV)" htmlFor="file" hint="Sarakkeet: viitenumero tai huoneisto, avoin, erääntynyt, vanhin eräpäivä">
                  <Input id="file" name="file" type="file" accept=".csv,text/csv" required className="py-2" />
                </Field>
                <Field label="Tilanne päivältä" htmlFor="as_of">
                  <Input id="as_of" name="as_of" type="date" defaultValue={today} required />
                </Field>
                <div>
                  <Button variant="secondary">Tuo maksutilanne</Button>
                </div>
              </form>
            ) : null}
            {imports.length > 0 ? (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {imports.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/taloyhtiot/${id}/talous/tuonnit/${i.id}`} className="min-w-0 hover:text-sky">
                      <span className="block truncate font-semibold">{formatDate(i.as_of)}</span>
                      <span className="block truncate text-xs text-ink/55">{i.file_name}</span>
                    </Link>
                    {i.unmatched.length > 0 ? <Badge tone="alert">{i.unmatched.length} kohdistamatta</Badge> : <Badge tone="ok">{i.matched} kohdistettu</Badge>}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Lainat</SectionTitle>
            {loans.length === 0 ? (
              <p className="text-sm text-ink/65">Yhtiölainoja ei ole kirjattu.</p>
            ) : (
              <ul className="divide-y divide-line">
                {loans.map((l) => (
                  <li key={l.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/taloyhtiot/${id}/talous/lainat/${l.id}`} className="font-semibold hover:text-sky">
                        {l.name}
                      </Link>
                      <span className="tabular font-semibold">{formatEur(l.balance_eur ?? l.principal_eur)}</span>
                    </div>
                    <p className="text-sm text-ink/60">
                      {[l.lender, l.balance_date ? `saldo ${formatDate(l.balance_date)}` : null, l.due_on ? `erääntyy ${formatDate(l.due_on)}` : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-ink/55">
                      {l.allocated ? (l.share_count > 0 ? `Lainaosuudet ${l.share_count} osakeryhmällä, jäljellä ${formatEur(l.shares_remaining)}` : "Lainaosuuksia ei ole laskettu") : "Ei jaettava laina"}
                      {l.paid_off_count > 0 ? ` · ${l.paid_off_count} kertasuoritusta` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-semibold">Lisää laina</summary>
                <form action={saveLoan} className="mt-3 grid gap-3">
                  <input type="hidden" name="company_id" value={id} />
                  <Field label="Nimi" htmlFor="loan_name">
                    <Input id="loan_name" name="name" required placeholder="Kattoremonttilaina 2026" />
                  </Field>
                  <Field label="Lainanantaja" htmlFor="lender">
                    <Input id="lender" name="lender" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pääoma (€)" htmlFor="principal_eur">
                      <Input id="principal_eur" name="principal_eur" inputMode="decimal" required />
                    </Field>
                    <Field label="Nostamatta (€)" htmlFor="undrawn_eur">
                      <Input id="undrawn_eur" name="undrawn_eur" inputMode="decimal" defaultValue="0" />
                    </Field>
                    <Field label="Saldo (€)" htmlFor="balance_eur">
                      <Input id="balance_eur" name="balance_eur" inputMode="decimal" />
                    </Field>
                    <Field label="Saldo päivältä" htmlFor="balance_date">
                      <Input id="balance_date" name="balance_date" type="date" />
                    </Field>
                    <Field label="Nostettu" htmlFor="drawn_on">
                      <Input id="drawn_on" name="drawn_on" type="date" />
                    </Field>
                    <Field label="Erääntyy" htmlFor="due_on">
                      <Input id="due_on" name="due_on" type="date" />
                    </Field>
                  </div>
                  <Field label="Korkoehdot" htmlFor="interest_terms">
                    <Input id="interest_terms" name="interest_terms" placeholder="12 kk euribor + 0,85 %" />
                  </Field>
                  <Field label="Käyttötarkoitus" htmlFor="purpose">
                    <Input id="purpose" name="purpose" />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="allocated" defaultChecked /> Jaettava laina (lainaosuudet osakeryhmille)
                  </label>
                  <div>
                    <Button variant="secondary">Tallenna laina</Button>
                  </div>
                </form>
              </details>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Laskutusasetukset</SectionTitle>
            <form action={saveBillingSettings} className="grid gap-3">
              <input type="hidden" name="company_id" value={id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Yhtiön numero" htmlFor="company_number" hint="Viitteen alku, yksilöllinen">
                  <Input id="company_number" name="company_number" inputMode="numeric" defaultValue={settings?.company_number ?? ""} required disabled={!canWrite} />
                </Field>
                <Field label="Eräpäivä" htmlFor="due_day" hint="Kuukauden päivä 1–28">
                  <Input id="due_day" name="due_day" inputMode="numeric" defaultValue={settings?.due_day ?? 5} required disabled={!canWrite} />
                </Field>
              </div>
              <Field label="IBAN" htmlFor="bank_iban">
                <Input id="bank_iban" name="bank_iban" defaultValue={settings?.bank_iban ?? ""} disabled={!canWrite} />
              </Field>
              <Field label="BIC" htmlFor="bank_bic">
                <Input id="bank_bic" name="bank_bic" defaultValue={settings?.bank_bic ?? ""} disabled={!canWrite} />
              </Field>
              <Field label="Lisätieto laskulle" htmlFor="billing_note">
                <Textarea id="billing_note" name="billing_note" defaultValue={settings?.billing_note ?? ""} disabled={!canWrite} />
              </Field>
              {settings && units.some((u) => u.seq_no) ? (
                <p className="text-xs text-coral">Yhtiön numeron muuttaminen muuttaa kaikkien huoneistojen viitteet. Tee se vain ennen ensimmäistä laskutusta.</p>
              ) : null}
              {canWrite ? (
                <div>
                  <Button variant="secondary">Tallenna asetukset</Button>
                </div>
              ) : null}
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function BasisTable({ rows, today }: { rows: Awaited<ReturnType<typeof loadChargeBases>>; today: string }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Vastike</Th>
          <Th numeric>Hinta</Th>
          <Th>Koskee</Th>
          <Th>Voimassa</Th>
          <Th>Päätös</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id}>
            <Td>
              <span className="font-semibold">{b.label || CHARGE_TYPE[b.charge_type]}</span>
              {b.starts_on > today ? (
                <span className="ml-2">
                  <Badge tone="info">Tulossa</Badge>
                </span>
              ) : null}
              {b.source === "htj" ? (
                <span className="ml-2">
                  <Badge tone="ok">HTJ</Badge>
                </span>
              ) : null}
            </Td>
            <Td numeric className="whitespace-nowrap">
              {formatPrice(b.unit_price)} {b.basis === "fixed" ? "€/kk" : b.basis === "meter" ? "€/yks." : `€/${BASIS[b.basis]?.unit}/kk`}
            </Td>
            <Td>{b.applies_to_kinds?.length ? b.applies_to_kinds.map((k) => UNIT_KIND[k] ?? k).join(", ") : "Kaikki"}</Td>
            <Td className="whitespace-nowrap">
              {formatDate(b.starts_on)} – {b.ends_on ? formatDate(b.ends_on) : ""}
            </Td>
            <Td>
              {b.decided_on ? formatDate(b.decided_on) : "–"}
              {b.decision_note ? <p className="text-xs text-ink/55">{b.decision_note}</p> : null}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
