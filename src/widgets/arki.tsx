import Link from "next/link";
import { Badge, LinkButton, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { listMyUpcomingBookings } from "@/lib/bookings/queries";
import { utcToHelsinki } from "@/lib/bookings/slots";
import { contractTiming } from "@/lib/contracts/deadlines";
import { listContracts } from "@/lib/contracts/queries";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { addDays, diffDays, finnishWeekdayShort, shortFinnishDate, startOfWeek } from "@/lib/tasks/dates";
import { listTasks, type TaskRow } from "@/lib/tasks/queries";

/**
 * Vuosikello, varaukset ja sopimukset (moduuli M6): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */

function TaskLines({ tasks, today }: { tasks: TaskRow[]; today: string }) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const late = t.due_on < today;
        return (
          <li key={t.id} className="flex items-baseline gap-3 py-2 text-sm">
            <span className={`tabular w-14 shrink-0 ${late ? "font-semibold text-coral" : "text-ink/60"}`}>{shortFinnishDate(t.due_on)}</span>
            <span className="min-w-0 flex-1">
              <Link href={`/vuosikello/${t.id}`} className="font-semibold hover:text-sky">{t.title}</Link>
              {t.company_name ? <span className="block truncate text-ink/55">{t.company_name}</span> : null}
            </span>
            {late ? <Badge tone="alert">{diffDays(t.due_on, today)} pv myöhässä</Badge> : null}
          </li>
        );
      })}
    </ul>
  );
}

export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const today = isoDateHelsinki();
  const nextWeekEnd = addDays(startOfWeek(today), 13);
  const [tasks, contracts] = await ctx.run((tx) =>
    Promise.all([
      listTasks(tx, { organizationId: ctx.org.organizationId, today, until: nextWeekEnd, limit: 50 }),
      listContracts(tx, { organizationId: ctx.org.organizationId }),
    ]),
  );
  const overdue = tasks.filter((t) => t.due_on < today);
  const upcoming = tasks.filter((t) => t.due_on >= today);
  const ending = contracts.map((c) => ({ c, t: contractTiming(c, today) })).filter((x) => x.t.endingSoon);

  return (
    <Panel>
      <SectionTitle actions={<Link href="/vuosikello" className="text-sm text-sky">Vuosikello</Link>}>Tehtävät ja määräajat</SectionTitle>
      {overdue.length === 0 && upcoming.length === 0 ? (
        <p className="text-sm text-ink/65">Ei tehtäviä tälle eikä ensi viikolle.</p>
      ) : null}
      {overdue.length > 0 ? (
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-coral">Myöhässä {overdue.length}</p>
          <TaskLines tasks={overdue.slice(0, 5)} today={today} />
          {overdue.length > 5 ? <Link href="/vuosikello?myohassa=1" className="text-sm text-sky">Kaikki myöhässä olevat</Link> : null}
        </div>
      ) : null}
      {upcoming.length > 0 ? (
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Tämä ja ensi viikko</p>
          <TaskLines tasks={upcoming.slice(0, 8)} today={today} />
        </div>
      ) : null}
      {ending.length > 0 ? (
        <div className="mt-2 border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber">Päättyvät sopimukset</p>
          <ul className="divide-y divide-line">
            {ending.slice(0, 5).map(({ c, t }) => (
              <li key={c.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/sopimukset/${c.id}`} className="font-semibold hover:text-sky">{c.counterparty}</Link>
                  <span className="block truncate text-ink/55">{c.company_name}</span>
                </span>
                <span className="shrink-0 text-right text-ink/70">
                  {t.deadline && t.daysToDeadline !== null && t.daysToDeadline >= 0 ? `irtisanottava ${formatDate(t.deadline)}` : `päättyy ${formatDate(c.ends_on)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const today = isoDateHelsinki();
  const [tasks, contracts] = await ctx.run((tx) =>
    Promise.all([
      listTasks(tx, { organizationId: ctx.org.organizationId, companyId, today, limit: 5 }),
      listContracts(tx, { organizationId: ctx.org.organizationId, companyId }),
    ]),
  );
  const active = contracts.map((c) => contractTiming(c, today)).filter((t) => t.effectiveStatus !== "ended");
  const endingSoon = active.filter((t) => t.endingSoon).length;

  return (
    <Panel>
      <SectionTitle actions={<Link href={`/vuosikello?yhtio=${companyId}`} className="text-sm text-sky">Vuosikello</Link>}>Seuraavat tehtävät</SectionTitle>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink/65">
          Ei avoimia tehtäviä. <Link href={`/vuosikello?yhtio=${companyId}`} className="text-sky">Luo vakiovuosikello</Link>
        </p>
      ) : (
        <TaskLines tasks={tasks} today={today} />
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
        <Link href={`/sopimukset?yhtio=${companyId}`} className="hover:text-sky">
          Voimassa olevat sopimukset: <span className="font-semibold">{active.length}</span>
        </Link>
        {endingSoon > 0 ? <Badge tone="warn">{endingSoon} päättymässä</Badge> : null}
      </div>
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  const canBook = ctx.user.portal.some((g) => (g.role === "owner" || g.role === "resident") && g.shareGroupId);
  if (!canBook) return null;
  const [bookings, resourceCount] = await ctx.run((tx) =>
    Promise.all([
      listMyUpcomingBookings(tx, ctx.user.id, 3),
      tx.query<{ n: number }>("select count(*)::int as n from er_bookable_resources where active").then((r) => r[0]?.n ?? 0),
    ]),
  );
  if (resourceCount === 0 && bookings.length === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/portaali/varaukset" className="text-sm text-sky">Kaikki</Link>}>Varaukset</SectionTitle>
      {bookings.length === 0 ? (
        <p className="text-sm text-ink/65">Ei tulevia varauksia.</p>
      ) : (
        <ul className="divide-y divide-line">
          {bookings.map((b) => {
            const s = utcToHelsinki(b.starts_at);
            const e = utcToHelsinki(b.ends_at);
            return (
              <li key={b.id} className="py-2 text-sm">
                <p className="font-semibold">
                  {finnishWeekdayShort(s.date)} {shortFinnishDate(s.date)} klo {s.time}–{e.time}
                </p>
                <p className="text-ink/60">{b.resource_name}</p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3">
        <LinkButton href="/portaali/varaukset" variant="secondary" className="w-full sm:w-auto">Varaa vuoro</LinkButton>
      </div>
    </Panel>
  );
}
