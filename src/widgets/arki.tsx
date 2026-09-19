import Link from "next/link";
import { Badge, LinkButton, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { listMyUpcomingBookings } from "@/lib/bookings/queries";
import { utcToHelsinki } from "@/lib/bookings/slots";
import { contractTiming } from "@/lib/contracts/deadlines";
import { listContracts } from "@/lib/contracts/queries";
import { isoDateHelsinki } from "@/lib/format";
import { addDays, diffDays, finnishWeekdayShort, shortFinnishDate } from "@/lib/tasks/dates";
import { listTasks, type TaskRow } from "@/lib/tasks/queries";
import type { DashboardItem, DashboardSource } from "@/lib/dashboard/items";
import { isDraftKey } from "@/lib/announcements/drafts";

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

/** Työpöydän rivit: vuosikellon tehtävät (myöhässä ja 60 päivää eteenpäin) ja sopimusten irtisanomisajat. */
export async function dashboardItems(ctx: StaffContext): Promise<DashboardSource> {
  const today = isoDateHelsinki();
  const [tasks, contracts] = await ctx.run((tx) =>
    Promise.all([
      listTasks(tx, { organizationId: ctx.org.organizationId, today, until: addDays(today, 60), limit: 300 }),
      listContracts(tx, { organizationId: ctx.org.organizationId }),
    ]),
  );
  const items: DashboardItem[] = tasks.map((t) => ({
    id: `tehtava-${t.id}`,
    category: "vuosikello",
    title: t.title,
    companyId: t.company_id,
    companyName: t.company_name,
    context: t.assignee_name && t.assignee_user_id !== ctx.user.id ? `vastuu ${t.assignee_name}` : null,
    href: isDraftKey(t.template_key) && t.company_id ? `/tiedotteet/uusi?yhtio=${t.company_id}&pohja=${t.template_key}` : `/vuosikello/${t.id}`,
    action: isDraftKey(t.template_key) ? "Laadi tiedote" : "Avaa",
    dueOn: t.due_on,
  }));
  for (const c of contracts) {
    const t = contractTiming(c, today);
    if (!t.endingSoon) continue;
    const byNotice = t.deadline !== null && t.daysToDeadline !== null && t.daysToDeadline >= 0;
    items.push({
      id: `sopimus-${c.id}`,
      category: "sopimus",
      title: byNotice ? `Sopimuksen irtisanomisaika päättyy: ${c.counterparty}` : `Sopimus päättyy: ${c.counterparty}`,
      companyId: c.company_id,
      companyName: c.company_name,
      href: `/sopimukset/${c.id}`,
      action: "Avaa",
      dueOn: byNotice ? t.deadline : c.ends_on,
    });
  }
  return { items };
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
      <SectionTitle actions={<Link href={`/taloyhtiot/${companyId}/vuosikello`} className="text-sm text-sky">Vuosikello</Link>}>Seuraavat tehtävät</SectionTitle>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink/65">
          Ei avoimia tehtäviä. <Link href={`/taloyhtiot/${companyId}/vuosikello`} className="text-sky">Luo vakiovuosikello</Link>
        </p>
      ) : (
        <TaskLines tasks={tasks} today={today} />
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
        <Link href={`/taloyhtiot/${companyId}/sopimukset`} className="hover:text-sky">
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
