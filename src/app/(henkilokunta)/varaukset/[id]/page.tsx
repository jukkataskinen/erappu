import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Notice, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getResource, listBookingsForStaff } from "@/lib/bookings/queries";
import { helsinkiLocalToUtc, openHoursSummary, utcToHelsinki } from "@/lib/bookings/slots";
import { isoDateHelsinki } from "@/lib/format";
import { addDays, finnishWeekdayShort, isIsoDate, isoWeekNumber, shortFinnishDate, startOfWeek } from "@/lib/tasks/dates";
import { staffCancelBookingAction } from "../actions";
import { ResourceForm } from "../ResourceForm";

export const metadata = { title: "Varauskohde" };

export default async function ResourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ viikko?: string; virhe?: string; tallennettu?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = isoDateHelsinki();
  const monday = startOfWeek(isIsoDate(sp.viikko) ? sp.viikko : today);
  const from = new Date(helsinkiLocalToUtc(monday, 0)!).toISOString();
  const to = new Date(helsinkiLocalToUtc(addDays(monday, 7), 0)!).toISOString();

  const [resource, bookings] = await ctx.run((tx) => Promise.all([getResource(tx, id), listBookingsForStaff(tx, id, from, to)]));
  if (!resource || resource.organization_id !== ctx.org.organizationId) notFound();
  const canWrite = ctx.can("owner", "manager", "assistant");
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const nowMs = Date.now();

  return (
    <>
      <PageHeader title={resource.name} subtitle={`${resource.company_name} · ${openHoursSummary(resource.open_hours)}`} back={{ href: "/varaukset", label: "Varaukset" }} />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Kohde tallennettu" />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Panel>
          <SectionTitle
            actions={
              <div className="flex items-center gap-1 text-sm">
                <Link href={`/varaukset/${id}?viikko=${addDays(monday, -7)}`} className="rounded-full px-3 py-2 hover:bg-cloud" aria-label="Edellinen viikko">←</Link>
                <Link href={`/varaukset/${id}`} className="rounded-full px-3 py-2 hover:bg-cloud">Tämä viikko</Link>
                <Link href={`/varaukset/${id}?viikko=${addDays(monday, 7)}`} className="rounded-full px-3 py-2 hover:bg-cloud" aria-label="Seuraava viikko">→</Link>
              </div>
            }
          >
            Viikko {isoWeekNumber(monday)} <span className="text-sm font-normal text-ink/55">{shortFinnishDate(monday)}–{shortFinnishDate(addDays(monday, 6), true)}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            {days.map((d) => {
              const items = bookings.filter((b) => utcToHelsinki(b.starts_at).date === d);
              return (
                <div key={d} className={`rounded-xl border p-2 ${d === today ? "border-sky/50 bg-sky-soft/40" : "border-line"}`}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
                    {finnishWeekdayShort(d)} {shortFinnishDate(d)}
                  </p>
                  {items.length === 0 ? (
                    <p className="text-xs text-ink/40">Vapaa</p>
                  ) : (
                    <ul className="grid gap-2">
                      {items.map((b) => {
                        const s = utcToHelsinki(b.starts_at);
                        const e = utcToHelsinki(b.ends_at);
                        const future = new Date(b.ends_at).getTime() > nowMs;
                        return (
                          <li key={b.id} className="rounded-lg bg-cloud px-2 py-1.5 text-xs">
                            <p className="tabular font-semibold">{s.time}–{e.time}</p>
                            <p>{b.unit_label ?? "–"}</p>
                            {b.booker_name ? <p className="truncate text-ink/60" title={b.booker_name}>{b.booker_name}</p> : null}
                            {b.recurring_weekly ? <Badge tone="info">Vakiovuoro</Badge> : null}
                            {canWrite && future ? (
                              <form action={staffCancelBookingAction} className="mt-1 flex flex-wrap gap-2">
                                <input type="hidden" name="resource_id" value={id} />
                                <input type="hidden" name="booking_id" value={b.id} />
                                <input type="hidden" name="viikko" value={monday} />
                                <button className="text-coral">Peru</button>
                                {b.recurring_weekly ? (
                                  <button name="series" value="1" className="text-coral">Peru sarja</button>
                                ) : null}
                              </form>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Kohteen tiedot</SectionTitle>
          <ResourceForm resource={resource} readOnly={!canWrite} />
        </Panel>
      </div>
    </>
  );
}
