import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, EmptyState, Field, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Stat, Table, Tabs, Td, Th, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { changePercent, monthlyTotals, sum } from "@/lib/consumption/aggregate";
import { ALLOWED_UNITS, CANONICAL_UNIT, UNIT_LABEL, UTILITIES, UTILITY_LABEL, type Utility } from "@/lib/consumption/labels";
import { companyHeatingTypes, heatingProfile, HEATING_TYPE_LABEL } from "@/lib/consumption/heating";
import { companyArea, listReadings } from "@/lib/consumption/queries";
import { formatDate, formatEur, formatNumber, isoDateHelsinki } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { addReadingAction, deleteReadingAction, importCsvAction } from "./actions";

export const metadata = { title: "Kulutusseuranta" };

const MONTH_SHORT = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];

type Search = { yhtio?: string; vuosi?: string; laji?: string; virhe?: string; tuotu?: string; paivitetty?: string; tallennettu?: string };

export default async function ConsumptionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const companies = await ctx.run((tx) => listCompanies(tx, ctx.org.organizationId));
  const thisYear = Number(isoDateHelsinki().slice(0, 4));
  const year = /^\d{4}$/.test(sp.vuosi ?? "") && Number(sp.vuosi) >= 2000 && Number(sp.vuosi) <= thisYear + 1 ? Number(sp.vuosi) : thisYear;
  const company = companies.find((c) => c.id === sp.yhtio) ?? companies[0];

  const header = (
    <PageHeader
      title="Kulutusseuranta"
      subtitle="Sähkö, vesi ja lämmitys (kaukolämpö tai öljy) yhtiöittäin"
      actions={
        <>
          <LinkButton variant="secondary" href="/sopimukset">Sopimukset</LinkButton>
          <LinkButton variant="secondary" href="/vuosikello">Vuosikello</LinkButton>
        </>
      }
    />
  );
  if (!company) {
    return (
      <>
        {header}
        <EmptyState title="Ei taloyhtiöitä" action={<LinkButton href="/taloyhtiot">Taloyhtiöt</LinkButton>} />
      </>
    );
  }

  const [readings, area, heatingTypes, readingUtilities] = await ctx.run((tx) =>
    Promise.all([
      listReadings(tx, company.id, year - 1, year),
      companyArea(tx, company.id),
      companyHeatingTypes(tx, company.id),
      tx.query<{ utility: Utility }>("select distinct utility from er_consumption_readings where company_id = $1", [company.id]),
    ]),
  );
  const heating = heatingProfile(heatingTypes, readingUtilities.map((r) => r.utility));
  const tabs: Utility[] = ["electricity", "water", ...heating.heatingUtilities];
  const utility: Utility = tabs.includes(sp.laji as Utility) && (UTILITIES as readonly string[]).includes(sp.laji ?? "") ? (sp.laji as Utility) : "electricity";
  const ofUtility = readings.filter((r) => r.utility === utility);
  const current = monthlyTotals(ofUtility, year);
  const previous = monthlyTotals(ofUtility, year - 1);
  const totalNow = sum(current.amount);
  const totalPrev = sum(previous.amount);
  // Kesken olevaa vuotta verrataan edellisen vuoden samoihin kuukausiin.
  const comparable = current.amount.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const change = changePercent(totalNow, sum(comparable.map((i) => previous.amount[i])));
  const partialYear = comparable.length > 0 && comparable.length < 12;
  const unit = UNIT_LABEL[CANONICAL_UNIT[utility]];
  const perM2 = area > 0 ? totalNow / area : null;
  const yearReadings = ofUtility.filter((r) => r.period_end >= `${year}-01-01` && r.period_start <= `${year}-12-31`);
  const link = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ yhtio: company.id, vuosi: String(year), laji: utility });
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/kulutus?${p.toString()}`;
  };

  return (
    <>
      {header}
      <FormError message={sp.virhe} />
      {sp.tuotu !== undefined ? (
        <div className="mb-5">
          <Notice tone="ok" title={`CSV tuotu: ${sp.tuotu} uutta lukemaa, ${sp.paivitetty ?? 0} päivitetty`} />
        </div>
      ) : null}
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Lukema tallennettu" />
        </div>
      ) : null}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4">
        <input type="hidden" name="laji" value={utility} />
        <div className="min-w-64 flex-1">
          <Field label="Yhtiö" htmlFor="f_yhtio">
            <Select id="f_yhtio" name="yhtio" defaultValue={company.id}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Vuosi" htmlFor="f_vuosi">
          <Select id="f_vuosi" name="vuosi" defaultValue={String(year)}>
            {Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary">Näytä</Button>
      </form>

      <Tabs items={tabs.map((u) => ({ key: u, label: UTILITY_LABEL[u], href: `/kulutus?yhtio=${company.id}&vuosi=${year}&laji=${u}` }))} active={utility} />
      {heating.note ? (
        <div className="-mt-3 mb-5">
          <Notice tone="info" title={heating.types.length ? `Lämmitys: ${heating.types.map((t) => HEATING_TYPE_LABEL[t]).join(", ")}` : "Lämmitysmuoto puuttuu"}>
            {heating.note}{" "}
            <Link href={`/taloyhtiot/${company.id}/kiinteisto`} className="text-sky">
              Rakennusten tiedot
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={`${UTILITY_LABEL[utility]} ${year}`} value={formatNumber(Math.round(totalNow), unit)} />
        <Stat label={`Muutos vuoteen ${year - 1}${partialYear ? " (samat kk)" : ""}`} value={change === null ? "–" : `${change > 0 ? "+" : ""}${formatNumber(change.toFixed(1))} %`} tone={change === null ? undefined : change > 5 ? "alert" : change < -5 ? "ok" : undefined} />
        <Stat label="Huoneistoalaa kohden" value={perM2 === null ? "–" : formatNumber(perM2.toFixed(2), `${unit}/m²`)} />
        <Stat label={`Kustannukset ${year}`} value={formatEur(sum(current.cost))} />
      </div>

      <Panel className="mt-6">
        <SectionTitle>
          Kuukausittain {year} ja {year - 1}
        </SectionTitle>
        {totalNow === 0 && totalPrev === 0 ? (
          <p className="text-sm text-ink/60">Ei lukemia valitulta ajalta. Lisää lukema käsin tai tuo CSV.</p>
        ) : (
          <BarChart current={current.amount} previous={previous.amount} year={year} unit={unit} />
        )}
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-6">
          <Table>
            <thead>
              <tr>
                <Th>Kuukausi</Th>
                <Th numeric>{year - 1}</Th>
                <Th numeric>{year}</Th>
                <Th numeric>Muutos</Th>
                <Th numeric>{unit}/m²</Th>
                <Th numeric>Kustannus</Th>
              </tr>
            </thead>
            <tbody>
              {MONTH_SHORT.map((m, i) => {
                const c = changePercent(current.amount[i], previous.amount[i]);
                return (
                  <tr key={m}>
                    <Td className="capitalize">{m}</Td>
                    <Td numeric>{previous.amount[i] ? formatNumber(Math.round(previous.amount[i])) : "–"}</Td>
                    <Td numeric>{current.amount[i] ? formatNumber(Math.round(current.amount[i])) : "–"}</Td>
                    <Td numeric className={c !== null && c > 5 ? "text-coral" : c !== null && c < -5 ? "text-moss" : undefined}>
                      {c === null || !current.amount[i] ? "–" : `${c > 0 ? "+" : ""}${c.toFixed(1).replace(".", ",")} %`}
                    </Td>
                    <Td numeric>{area > 0 && current.amount[i] ? formatNumber((current.amount[i] / area).toFixed(2)) : "–"}</Td>
                    <Td numeric>{current.cost[i] ? formatEur(current.cost[i]) : "–"}</Td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <Td>Yhteensä</Td>
                <Td numeric>{formatNumber(Math.round(totalPrev))}</Td>
                <Td numeric>{formatNumber(Math.round(totalNow))}</Td>
                <Td numeric>{change === null ? "–" : `${change > 0 ? "+" : ""}${change.toFixed(1).replace(".", ",")} %`}</Td>
                <Td numeric>{perM2 === null ? "–" : formatNumber(perM2.toFixed(2))}</Td>
                <Td numeric>{formatEur(sum(current.cost))}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-xs text-ink/55">
            Jaksot jaetaan kuukausille päivien suhteessa{utility === "oil" ? " (öljyn täyttöerät kannattaa kirjata kulutusjaksolle, ei toimituspäivälle)" : ""}. MWh muunnetaan kWh:ksi. Huoneistoala {area > 0 ? formatNumber(area, "m²") : "puuttuu (lisää huoneistojen pinta-alat)"}.
          </p>

          <Panel>
            <SectionTitle>Lukemat {year}</SectionTitle>
            {yearReadings.length === 0 ? (
              <p className="text-sm text-ink/60">Ei lukemia.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {yearReadings.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="tabular">
                      {formatDate(r.period_start)}–{formatDate(r.period_end)}
                    </span>
                    <span className="tabular">
                      {formatNumber(r.amount, UNIT_LABEL[r.unit])}
                      {r.cost_eur ? ` · ${formatEur(r.cost_eur)}` : ""}
                      <span className="ml-2 text-xs text-ink/50">{r.source === "csv" ? "CSV" : "käsin"}</span>
                    </span>
                    <form action={deleteReadingAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-coral" aria-label={`Poista lukema ${formatDate(r.period_start)}–${formatDate(r.period_end)}`}>Poista</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Lisää lukema</SectionTitle>
            <form action={addReadingAction} className="grid gap-3">
              <input type="hidden" name="company_id" value={company.id} />
              <input type="hidden" name="utility" value={utility} />
              <p className="text-sm text-ink/65">
                {company.name} · {UTILITY_LABEL[utility].toLowerCase()}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Alkaa" htmlFor="period_start">
                  <Input id="period_start" name="period_start" type="date" required />
                </Field>
                <Field label="Päättyy" htmlFor="period_end">
                  <Input id="period_end" name="period_end" type="date" required />
                </Field>
                <Field label="Määrä" htmlFor="amount">
                  <Input id="amount" name="amount" inputMode="decimal" required />
                </Field>
                <Field label="Yksikkö" htmlFor="unit">
                  <Select id="unit" name="unit" defaultValue={ALLOWED_UNITS[utility][0]}>
                    {ALLOWED_UNITS[utility].map((u) => (
                      <option key={u} value={u}>
                        {u === "l" ? "litraa" : UNIT_LABEL[u]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Kustannus (€)" htmlFor="cost_eur">
                <Input id="cost_eur" name="cost_eur" inputMode="decimal" />
              </Field>
              <div>
                <Button variant="secondary">Tallenna lukema</Button>
              </div>
            </form>
          </Panel>

          <Panel>
            <SectionTitle>Tuo CSV</SectionTitle>
            <p className="mb-3 text-sm text-ink/65">
              Sarakkeet: yhtiön Y-tunnus tai nimi; laji (sähkö, vesi, kaukolämpö, öljy); alkupvm; loppupvm; määrä; yksikkö (kWh, MWh, m3, l); kustannus. Otsikkorivi saa olla mukana.
              Sama yhtiö, laji ja jakso päivitetään.
            </p>
            <form action={importCsvAction} className="grid gap-3">
              <input type="hidden" name="company_id" value={company.id} />
              <Field label="CSV-tiedosto" htmlFor="file">
                <Input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className="py-2" />
              </Field>
              <Field label="Tai liitä rivit" htmlFor="csv_text">
                <Textarea id="csv_text" name="csv_text" placeholder={`${company.business_id};sähkö;1.1.${year};31.1.${year};12 500;kWh;1 850,00`} className="font-mono text-sm" />
              </Field>
              <div>
                <Button variant="secondary">Tuo lukemat</Button>
              </div>
            </form>
          </Panel>
          <p className="text-sm">
            <Link href={link({ vuosi: year - 1 })} className="text-sky">← Vuosi {year - 1}</Link>
          </p>
        </div>
      </div>
    </>
  );
}

function BarChart({ current, previous, year, unit }: { current: number[]; previous: number[]; year: number; unit: string }) {
  const W = 720;
  const H = 240;
  const pad = { top: 16, right: 8, bottom: 28, left: 56 };
  const max = Math.max(...current, ...previous, 1);
  const niceMax = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / pow) * pow;
  })();
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const group = plotW / 12;
  const barW = Math.min(18, group * 0.36);
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex gap-4 text-xs text-ink/70">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-ink/20" aria-hidden />{year - 1}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-sky" aria-hidden />{year}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={`Kulutus kuukausittain ${year} ja ${year - 1} (${unit}). Luvut taulukossa alla.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink/55 text-[11px]">
              {formatNumber(Math.round(t))}
            </text>
          </g>
        ))}
        {MONTH_SHORT.map((m, i) => {
          const cx = pad.left + group * i + group / 2;
          return (
            <g key={m}>
              <rect x={cx - barW - 1} y={y(previous[i])} width={barW} height={Math.max(0, pad.top + plotH - y(previous[i]))} rx={2} className="fill-ink/20">
                <title>{`${m} ${year - 1}: ${formatNumber(Math.round(previous[i]), unit)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(current[i])} width={barW} height={Math.max(0, pad.top + plotH - y(current[i]))} rx={2} className="fill-sky">
                <title>{`${m} ${year}: ${formatNumber(Math.round(current[i]), unit)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-ink/60 text-[11px]">{m}</text>
            </g>
          );
        })}
        <text x={pad.left} y={10} className="fill-ink/55 text-[11px]">{unit}</text>
      </svg>
    </div>
  );
}
