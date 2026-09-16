import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, SectionTitle } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime, formatEur, formatNumber, isoDateHelsinki } from "@/lib/format";
import { maintainMarketplace } from "@/lib/marketplace/mutations";
import { listOpenForProvider, listProviderReservations, resolveMarketplaceProvider } from "@/lib/marketplace/queries";
import { LISTING_STATUS_LABEL, MAX_ESTIMATE_DAYS_AHEAD, RESERVATION_DAYS } from "@/lib/marketplace/rules";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { openTask, reserve } from "./actions";

export const metadata = { title: "Huoltotöiden tori" };
export const dynamic = "force-dynamic";

const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default async function MarketplacePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const { token } = await params;
  const { virhe, tila } = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  const db = await getDb();
  const data = await db.asService(async (tx) => {
    const provider = await resolveMarketplaceProvider(tx, token);
    if (!provider) return null;
    // Rauenneet varaukset palautetaan torille ennen listausta, jotta kaikki näkevät ajantasaisen tilanteen.
    await maintainMarketplace(tx);
    const open = await listOpenForProvider(tx, provider);
    const mine = await listProviderReservations(tx, provider);
    return { provider, open, mine };
  });

  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10">
        <Brand />
        <h1 className="mt-6 text-2xl">Linkki ei ole voimassa</h1>
        <p className="mt-2 text-ink/70">Torilinkki on vanhentunut tai korvattu uudella. Pyydä uusi linkki isännöinniltä.</p>
      </div>
    );
  }
  const { provider, open, mine } = data;
  const today = isoDateHelsinki();

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-8">
      <Brand />
      <p className="mt-6 text-sm text-ink/60">{provider.name}</p>
      <h1 className="mt-1 text-2xl">Huoltotöiden tori</h1>
      <p className="mt-2 text-sm text-ink/70">
        Varaa työ antamalla arvioitu toteutuspäivä ja tuntiarvio. Työ laskutetaan tuntihinnallasi
        {provider.hourlyRateEur ? ` (${formatEur(provider.hourlyRateEur)}/h)` : ""}. Varaus on voimassa {RESERVATION_DAYS} päivää: jos työtä ei ole kuitattu valmiiksi,
        se palaa torille. Osoite ja yhteystiedot näkyvät varauksen jälkeen.
      </p>

      <div className="mt-4 grid gap-3">
        <FormError message={virhe} />
        {tila === "odottaa" ? (
          <Notice tone="info" title="Varaus odottaa isännöitsijän hyväksyntää">
            Arviosi ylittää taloyhtiön rajan tilata töitä torilta. Saat tiedon, kun isännöitsijä on käsitellyt varauksen.
          </Notice>
        ) : null}
        {!provider.hourlyRateEur ? (
          <Notice tone="warn" title="Tuntihintaa ei ole kirjattu">
            Ilmoita tuntihintasi isännöintiin. Ilman sitä töitä ei voi varata.
          </Notice>
        ) : null}
      </div>

      {mine.length > 0 ? (
        <Panel className="mt-5">
          <SectionTitle>Omat varaukset</SectionTitle>
          <ul className="divide-y divide-line">
            {mine.map((m) => (
              <li key={m.id} className="grid gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{m.company_name}</p>
                    <p className="text-sm text-ink/65">
                      {CATEGORY_LABEL[m.category]} · {m.summary}
                    </p>
                  </div>
                  <Badge tone={m.status === "reserved" ? "ok" : m.status === "pending_approval" ? "warn" : "neutral"}>{LISTING_STATUS_LABEL[m.status]}</Badge>
                </div>
                <p className="text-xs text-ink/60">
                  Arvio {formatNumber(m.estimated_hours, "h")}, toteutus {formatDate(m.estimated_on)}
                  {m.status !== "completed" && m.reserve_expires_at ? ` · varaus voimassa ${formatDateTime(m.reserve_expires_at)} asti` : ""}
                </p>
                {m.status === "reserved" ? (
                  <form action={openTask}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="listing_id" value={m.id} />
                    <Button type="submit" variant="secondary">
                      Avaa työtilaus
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <section className="mt-5 grid gap-3">
        <h2 className="text-lg">Vapaat työt</h2>
        {open.length === 0 ? (
          <EmptyState title="Torilla ei ole nyt töitä">Tarkista myöhemmin uudelleen.</EmptyState>
        ) : (
          open.map((l) => (
            <Panel key={l.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{CATEGORY_LABEL[l.category]}</p>
                  <p className="text-sm text-ink/65">
                    {l.city ?? "Paikkakunta ei tiedossa"} · lisätty {formatDate(l.listed_at)}
                  </p>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words">{l.summary}</p>
              {provider.hourlyRateEur ? (
                <form action={reserve} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="listing_id" value={l.id} />
                  <Field label="Arvioitu toteutuspäivä" htmlFor={`on-${l.id}`}>
                    <Input id={`on-${l.id}`} name="estimated_on" type="date" required min={today} max={addDaysIso(today, MAX_ESTIMATE_DAYS_AHEAD)} />
                  </Field>
                  <Field label="Tuntiarvio" htmlFor={`h-${l.id}`}>
                    <Input id={`h-${l.id}`} name="estimated_hours" inputMode="decimal" required placeholder="esim. 2,5" />
                  </Field>
                  <Button type="submit">Varaa työ</Button>
                </form>
              ) : null}
            </Panel>
          ))
        )}
      </section>
    </div>
  );
}
