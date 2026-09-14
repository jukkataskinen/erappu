import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Badge, EmptyState, LinkButton, Notice, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { getResource, listMyUpcomingBookings, listResources, resourceBusy, type MyBookingRow } from "@/lib/bookings/queries";
import { helsinkiLocalToUtc, openHoursSummary, slotState, utcToHelsinki, weekSlots } from "@/lib/bookings/slots";
import { formatEur, isoDateHelsinki } from "@/lib/format";
import { addDays, finnishWeekdayShort, isIsoDate, isoWeekNumber, shortFinnishDate, startOfWeek } from "@/lib/tasks/dates";
import { bookSlotAction, cancelOwnBookingAction } from "./actions";

export const metadata = { title: "Varaukset" };

type Search = { kohde?: string; viikko?: string; huoneisto?: string; vakio?: string; virhe?: string; varattu?: string; ohitettu?: string; peruttu?: string };

export default async function PortalBookingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePortal();
  const sp = await searchParams;
  const grants = ctx.user.portal.filter((g) => (g.role === "owner" || g.role === "resident") && g.shareGroupId);
  const units = [...new Map(grants.map((g) => [g.shareGroupId!, g])).values()];

  if (units.length === 0) {
    return (
      <>
        <h1 className="text-2xl">Varaukset</h1>
        <div className="mt-4">
          <EmptyState title="Varaukset ovat osakkaille ja asukkaille">Saunavuorot ja pesutuvan varaukset tehdään huoneiston nimissä.</EmptyState>
        </div>
      </>
    );
  }

  const today = isoDateHelsinki();
  const resourceId = sp.kohde && /^[0-9a-f-]{36}$/i.test(sp.kohde) ? sp.kohde : null;
  const [resources, mine] = await ctx.run((tx) => Promise.all([listResources(tx, { activeOnly: true }), listMyUpcomingBookings(tx, ctx.user.id, 50)]));
  const notices = (
    <>
      <FormError message={sp.virhe} />
      {sp.varattu ? (
        <div className="mb-4" role="status">
          <Notice tone="ok" title={Number(sp.varattu) > 1 ? `Vakiovuoro varattu ${sp.varattu} viikolle` : "Vuoro varattu"}>
            {sp.ohitettu ? `${sp.ohitettu} viikkoa ohitettiin, koska vuoro oli jo varattu.` : null}
          </Notice>
        </div>
      ) : null}
      {sp.peruttu ? (
        <div className="mb-4" role="status">
          <Notice tone="ok" title={Number(sp.peruttu) > 1 ? `${sp.peruttu} varausta peruttu` : "Varaus peruttu"} />
        </div>
      ) : null}
    </>
  );

  if (!resourceId) {
    return (
      <>
        <h1 className="text-2xl">Varaukset</h1>
        <div className="mt-4">{notices}</div>
        <section className="mt-4">
          <h2 className="mb-2 text-lg">Omat tulevat varaukset</h2>
          <MyBookings bookings={mine} />
        </section>
        <section className="mt-6">
          <h2 className="mb-2 text-lg">Varattavat tilat</h2>
          {resources.length === 0 ? (
            <EmptyState title="Yhtiössä ei ole varattavia tiloja">Isännöitsijä lisää saunan tai pesutuvan varattavaksi.</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {resources.map((r) => (
                <li key={r.id}>
                  <Link href={`/portaali/varaukset?kohde=${r.id}`} className="block rounded-[var(--radius-panel)] border border-line bg-paper p-4 hover:border-ink/25">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-lg font-semibold">{r.name}</span>
                      <span className="text-sky" aria-hidden>→</span>
                    </span>
                    {ctx.companies.length > 1 ? <span className="block text-sm text-ink/60">{r.company_name}</span> : null}
                    <span className="mt-1 block text-sm text-ink/65">{openHoursSummary(r.open_hours)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  const resource = await ctx.run((tx) => getResource(tx, resourceId));
  if (!resource || !resource.active) {
    return (
      <>
        <h1 className="text-2xl">Varaukset</h1>
        <div className="mt-4">
          <EmptyState title="Kohdetta ei löytynyt" action={<LinkButton href="/portaali/varaukset">Takaisin</LinkButton>} />
        </div>
      </>
    );
  }

  const myUnits = units.filter((g) => g.companyId === resource.company_id);
  const unit = myUnits.find((g) => g.shareGroupId === sp.huoneisto) ?? myUnits[0];
  const monday = startOfWeek(isIsoDate(sp.viikko) && sp.viikko >= startOfWeek(today) ? sp.viikko : today);
  const from = new Date(helsinkiLocalToUtc(monday, 0)!).toISOString();
  const to = new Date(helsinkiLocalToUtc(addDays(monday, 7), 0)!).toISOString();
  const busy = await ctx.run((tx) => resourceBusy(tx, resource.id, from, to));
  const days = weekSlots(monday, resource.open_hours, resource.slot_minutes);
  const now = new Date();
  const recurring = resource.allow_recurring && sp.vakio === "1";
  const mineHere = mine.filter((b) => b.resource_id === resource.id);
  const activeSeries = new Set(mineHere.map((b) => b.series_id ?? b.id)).size;
  const query = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ kohde: resource.id });
    const merged = { viikko: sp.viikko, huoneisto: sp.huoneisto, vakio: sp.vakio, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/portaali/varaukset?${p.toString()}`;
  };

  return (
    <>
      <Link href="/portaali/varaukset" className="text-sm text-ink/60 hover:text-ink">← Varaukset</Link>
      <h1 className="mt-2 text-2xl">{resource.name}</h1>
      <p className="mt-1 text-sm text-ink/65">
        {resource.company_name} · {resource.slot_minutes} min vuoro{resource.price_eur ? ` · ${formatEur(resource.price_eur)}` : ""}
      </p>
      {resource.description ? <p className="mt-2 whitespace-pre-line text-sm">{resource.description}</p> : null}

      <div className="mt-4">{notices}</div>

      {!unit ? (
        <Notice tone="warn" title="Sinulla ei ole huoneistoa tässä yhtiössä" />
      ) : (
        <>
          {myUnits.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Huoneisto">
              {myUnits.map((g) => (
                <Link
                  key={g.shareGroupId}
                  href={query({ huoneisto: g.shareGroupId! })}
                  aria-current={g.shareGroupId === unit.shareGroupId ? "true" : undefined}
                  className={`inline-flex min-h-[var(--size-touch)] items-center rounded-full border px-4 text-sm font-semibold ${g.shareGroupId === unit.shareGroupId ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
                >
                  {g.unitLabel ?? "Huoneisto"}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {resource.max_active_bookings_per_unit ? (
              <Badge tone={activeSeries >= resource.max_active_bookings_per_unit ? "warn" : "neutral"}>
                Tulevia varauksia {activeSeries}/{resource.max_active_bookings_per_unit}
              </Badge>
            ) : null}
            {resource.allow_recurring ? (
              <Link
                href={query({ vakio: recurring ? "" : "1" })}
                className={`inline-flex min-h-[var(--size-touch)] items-center rounded-full border px-4 font-semibold ${recurring ? "border-sky bg-sky-soft text-sky" : "border-line bg-paper"}`}
                aria-pressed={recurring}
              >
                {recurring ? "Vakiovuoro päällä (12 viikkoa)" : "Varaa vakiovuorona"}
              </Link>
            ) : null}
          </div>

          <div className="sticky top-14 z-[5] -mx-5 mt-4 flex items-center justify-between border-b border-line bg-cloud/95 px-5 py-2 backdrop-blur">
            {monday > startOfWeek(today) ? (
              <Link href={query({ viikko: addDays(monday, -7) })} className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-sm" aria-label="Edellinen viikko">←</Link>
            ) : (
              <span className="min-w-11" />
            )}
            <p className="text-sm font-semibold">
              Viikko {isoWeekNumber(monday)} <span className="font-normal text-ink/60">{shortFinnishDate(monday)}–{shortFinnishDate(addDays(monday, 6))}</span>
            </p>
            <Link href={query({ viikko: addDays(monday, 7) })} className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-sm" aria-label="Seuraava viikko">→</Link>
          </div>

          <div className="mt-3 grid gap-4">
            {days.map(({ date, slots }) => {
              const visible = slots.filter((s) => new Date(s.endsAt).getTime() > now.getTime());
              if (date < today) return null;
              return (
                <section key={date} aria-label={`${finnishWeekdayShort(date)} ${shortFinnishDate(date)}`}>
                  <h2 className={`mb-2 text-sm font-semibold ${date === today ? "text-sky" : ""}`}>
                    {date === today ? "Tänään" : finnishWeekdayShort(date)} {shortFinnishDate(date)}
                  </h2>
                  {visible.length === 0 ? (
                    <p className="text-sm text-ink/45">{slots.length ? "Ei enää vuoroja tänään" : "Suljettu"}</p>
                  ) : (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {visible.map((s) => {
                        const st = slotState(s, busy, now);
                        const label = `${s.startLocal}–${s.endLocal}`;
                        if (st.state === "free") {
                          return (
                            <li key={s.startsAt}>
                              <form action={bookSlotAction}>
                                <input type="hidden" name="resource_id" value={resource.id} />
                                <input type="hidden" name="share_group_id" value={unit.shareGroupId!} />
                                <input type="hidden" name="starts_at" value={s.startsAt} />
                                <input type="hidden" name="viikko" value={monday} />
                                {recurring ? <input type="hidden" name="recurring" value="1" /> : null}
                                <button
                                  className="tabular flex min-h-[var(--size-touch)] w-full flex-col items-center justify-center rounded-xl border border-sky/40 bg-paper px-1 py-1.5 text-sm font-semibold text-ink hover:border-sky"
                                  aria-label={`Varaa ${finnishWeekdayShort(date)} ${shortFinnishDate(date)} klo ${label}${recurring ? " vakiovuorona" : ""}`}
                                >
                                  {s.startLocal}
                                  <span className="text-[11px] font-normal text-sky">Varaa</span>
                                </button>
                              </form>
                            </li>
                          );
                        }
                        return (
                          <li key={s.startsAt}>
                            <div
                              className={`tabular flex min-h-[var(--size-touch)] w-full flex-col items-center justify-center rounded-xl px-1 py-1.5 text-sm ${st.state === "mine" ? "border border-moss/40 bg-moss-soft font-semibold text-moss" : "bg-cloud text-ink/40"}`}
                              aria-label={`${label} ${st.state === "mine" ? "oma varaus" : "varattu"}`}
                            >
                              {s.startLocal}
                              <span className="text-[11px] font-normal">{st.state === "mine" ? "Oma" : "Varattu"}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {mineHere.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-lg">Omat varaukset tähän tilaan</h2>
              <MyBookings bookings={mineHere} week={monday} />
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function MyBookings({ bookings, week }: { bookings: MyBookingRow[]; week?: string }) {
  if (bookings.length === 0) return <p className="text-sm text-ink/60">Ei tulevia varauksia.</p>;
  // Vakiovuorosta näytetään seuraava kerta ja viikkojen määrä, ei 12 riviä.
  const shown: (MyBookingRow & { count: number })[] = [];
  for (const b of bookings) {
    const existing = b.recurring_weekly ? shown.find((x) => x.series_id === b.series_id) : undefined;
    if (existing) existing.count++;
    else shown.push({ ...b, count: 1 });
  }
  return (
    <ul className="grid gap-2">
      {shown.map((b) => {
        const s = utcToHelsinki(b.starts_at);
        const e = utcToHelsinki(b.ends_at);
        return (
          <li key={b.id}>
            <Panel className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-4">
              <div className="min-w-0">
                <p className="font-semibold">
                  {finnishWeekdayShort(s.date)} {shortFinnishDate(s.date)} klo {s.time}–{e.time}
                </p>
                <p className="text-sm text-ink/65">
                  {b.resource_name}
                  {b.unit_label ? ` · ${b.unit_label}` : ""}
                  {b.count > 1 ? ` · vakiovuoro, ${b.count} kertaa` : ""}
                </p>
              </div>
              <form action={cancelOwnBookingAction} className="flex gap-2">
                <input type="hidden" name="booking_id" value={b.id} />
                {week ? (
                  <>
                    <input type="hidden" name="resource_id" value={b.resource_id} />
                    <input type="hidden" name="viikko" value={week} />
                  </>
                ) : null}
                <button className="min-h-[var(--size-touch)] rounded-full border border-line bg-paper px-4 text-sm font-semibold text-coral">Peru</button>
                {b.count > 1 ? (
                  <button name="series" value="1" className="min-h-[var(--size-touch)] rounded-full border border-line bg-paper px-4 text-sm font-semibold text-coral">Peru kaikki</button>
                ) : null}
              </form>
            </Panel>
          </li>
        );
      })}
    </ul>
  );
}
