import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatEur, isoDateHelsinki } from "@/lib/format";
import { letterCounters, listBillingRuns } from "@/lib/letters/billing";
import { addDays, letterPricesFrom, previousQuarter } from "@/lib/letters/pricing";
import { createBillingRunAction } from "./actions";

export const metadata = { title: "Postikulut" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Postikulujen laskurit ja laskutus (Jukka 26.9.2026). Postitukset menevät
 * taloyhtiön maksettaviksi organisaation kirjehinnalla. Oletusjakso on
 * edellinen vuosineljännes, koska postikulut laskutetaan noin kolmen
 * kuukauden välein.
 */
export default async function LetterCostsPage({ searchParams }: { searchParams: Promise<{ alku?: string; loppu?: string; virhe?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "accountant")) notFound();
  const sp = await searchParams;
  const today = isoDateHelsinki();
  const quarter = previousQuarter(today);
  const start = sp.alku && ISO.test(sp.alku) ? sp.alku : quarter.start;
  const end = sp.loppu && ISO.test(sp.loppu) ? sp.loppu : quarter.end;

  const { counters, runs, prices } = await ctx.run(async (tx) => {
    const [org] = await tx.query<{ settings: { letter_prices?: Record<string, unknown> } | null }>("select settings from er_organizations where id = $1", [ctx.org.organizationId]);
    return {
      counters: await letterCounters(tx, ctx.org.organizationId, { start, end }),
      runs: await listBillingRuns(tx, ctx.org.organizationId),
      prices: letterPricesFrom(org?.settings),
    };
  });
  const sum = (f: (c: (typeof counters)[number]) => number) => Math.round(counters.reduce((a, c) => a + f(c), 0) * 100) / 100;
  const unbilled = sum((c) => c.unbilled_eur);

  return (
    <>
      <PageHeader
        title="Postikulut"
        subtitle="Paperikutsut ja tiedotteet Postitan kautta laskutetaan taloyhtiöiltä organisaation kirjehinnalla. Laskut viedään Fennoaan luonnoksina."
      />
      <FormError message={sp.virhe} />
      {!prices ? (
        <div className="mb-5">
          <Notice tone="warn" title="Kirjehinnat puuttuvat">
            Aseta kirjeiden hinnat taloyhtiöille <Link href="/asetukset/organisaatio" className="text-sky">organisaation asetuksiin</Link>. Ilman niitä postitusta ei voi
            vahvistaa eikä laskuttaa.
          </Notice>
        </div>
      ) : null}

      <Panel>
        <form className="flex flex-wrap items-end gap-3">
          <Field label="Jakso alkaa" htmlFor="alku">
            <Input id="alku" name="alku" type="date" defaultValue={start} />
          </Field>
          <Field label="Jakso päättyy" htmlFor="loppu">
            <Input id="loppu" name="loppu" type="date" defaultValue={end} />
          </Field>
          <Button variant="secondary">Näytä</Button>
          <p className="w-full text-xs text-ink/55">Postitus kuuluu jaksoon vahvistuspäivänsä mukaan. Oletuksena edellinen vuosineljännes.</p>
        </form>
      </Panel>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Postituksia" value={sum((c) => c.mailings)} />
        <Stat label="Kirjeitä" value={sum((c) => c.letters)} />
        <Stat label="Postitan hinta (alv 0)" value={formatEur(sum((c) => c.cost_eur))} />
        <Stat label="Laskuttamatta (alv 0)" value={formatEur(unbilled)} tone={unbilled > 0 ? "warn" : undefined} />
      </div>

      <div className="mt-6">
        {counters.length === 0 ? (
          <EmptyState title="Ei postituksia jaksolla">Vahvistetut postitukset näkyvät tässä taloyhtiöittäin.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Taloyhtiö</Th>
                <Th numeric>Postituksia</Th>
                <Th numeric>Kirjeitä</Th>
                <Th numeric>Sivuja</Th>
                <Th numeric>Postitan hinta</Th>
                <Th numeric>Veloitus</Th>
                <Th numeric>Laskuttamatta</Th>
                <Th>Laskutustiedot</Th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c) => (
                <tr key={c.company_id}>
                  <Td className="font-semibold">{c.company_name}</Td>
                  <Td numeric>{c.mailings}</Td>
                  <Td numeric>{c.letters}</Td>
                  <Td numeric>{c.pages}</Td>
                  <Td numeric>{formatEur(c.cost_eur)}</Td>
                  <Td numeric>
                    {formatEur(c.charge_eur)}
                    {c.unpriced ? <p className="text-xs text-amber">{c.unpriced} ilman lukittua hintaa</p> : null}
                  </Td>
                  <Td numeric>{c.unbilled_eur > 0 ? formatEur(c.unbilled_eur) : "–"}</Td>
                  <Td>
                    <Link href={`/postikulut/yhtio/${c.company_id}`} className="text-sky">
                      {c.has_profile_problems ? <Badge tone="warn">Täydennä</Badge> : "Muokkaa"}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {unbilled > 0 && prices ? (
        <Panel className="mt-6">
          <SectionTitle>Laskutusajo</SectionTitle>
          <form action={createBillingRunAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="period_start" value={start} />
            <input type="hidden" name="period_end" value={end} />
            <Field label="Laskun päivä" htmlFor="invoice_date">
              <Input id="invoice_date" name="invoice_date" type="date" defaultValue={today} />
            </Field>
            <Field label="Eräpäivä" htmlFor="due_date">
              <Input id="due_date" name="due_date" type="date" defaultValue={addDays(today, 14)} />
            </Field>
            <Button>Tee laskut jaksolta {formatDate(start)}–{formatDate(end)}</Button>
            <p className="w-full text-xs text-ink/55">
              Yksi lasku taloyhtiötä kohden, jokainen postitus omalla rivillään. Laskuttamattomat postitukset sidotaan ajoon, joten niitä ei laskuteta kahdesti. Ajon
              voi poistaa, kunnes laskut on viety Fennoaan.
            </p>
          </form>
        </Panel>
      ) : null}

      <Panel className="mt-6">
        <SectionTitle>Laskutusajot</SectionTitle>
        {runs.length === 0 ? (
          <p className="text-sm text-ink/60">Ei laskutusajoja.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Jakso</Th>
                <Th numeric>Laskuja</Th>
                <Th numeric>Viety Fennoaan</Th>
                <Th numeric>Yhteensä alv 0</Th>
                <Th>Tehty</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="row-link hover:bg-cloud/50">
                  <Td>
                    <Link href={`/postikulut/ajo/${r.id}`} className="row-link-main font-semibold hover:text-sky">
                      {formatDate(r.period_start)}–{formatDate(r.period_end)}
                    </Link>
                  </Td>
                  <Td numeric>{r.invoices}</Td>
                  <Td numeric>{r.exported}</Td>
                  <Td numeric>{formatEur(r.total_net_eur)}</Td>
                  <Td>
                    {formatDateTime(r.created_at)}
                    {r.created_by_name ? `, ${r.created_by_name}` : ""}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
