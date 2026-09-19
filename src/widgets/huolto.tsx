import Link from "next/link";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { Panel, SectionTitle } from "@/components/ui";
import { StatusBadge, UrgencyBadge } from "@/lib/service-requests/components/parts";
import { listPortalRequests, listRequests } from "@/lib/service-requests/queries";
import { isOpen } from "@/lib/service-requests/status";
import type { DashboardItem, DashboardSource } from "@/lib/dashboard/items";
import { isoDateHelsinki } from "@/lib/format";

/**
 * Huoltopyynnöt (moduuli M1): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */
/** Työpöydän rivit: uudet, kiireelliset ja myöhässä olevat huoltopyynnöt. */
export async function dashboardItems(ctx: StaffContext): Promise<DashboardSource> {
  const open = await ctx.run((tx) => listRequests(tx, ctx.org.organizationId, { openOnly: true, limit: 500 }));
  const today = isoDateHelsinki();
  const items: DashboardItem[] = open
    .filter((r) => r.status === "new" || r.overdue || r.urgency === "urgent")
    .map((r) => ({
      id: `huolto-${r.id}`,
      category: "huolto" as const,
      title: `#${r.number} ${r.title}`,
      companyId: r.company_id,
      companyName: r.company_name,
      context: [r.unit_label, r.urgency === "urgent" ? "kiireellinen" : null, r.provider_name].filter(Boolean).join(" · ") || null,
      href: `/huoltopyynnot/${r.id}`,
      action: r.status === "new" ? "Käsittele" : "Avaa",
      dueOn: r.status === "new" ? null : r.overdue ? (r.due_on ?? today) : r.due_on,
      waiting: r.status === "new",
      since: isoDateHelsinki(new Date(r.created_at)),
    }));
  return { items };
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const open = await ctx.run((tx) => listRequests(tx, ctx.org.organizationId, { companyId, openOnly: true, limit: 50 }));
  return (
    <Panel>
      <SectionTitle actions={<Link href={`/taloyhtiot/${companyId}/huolto`} className="text-sm text-sky">Kaikki</Link>}>Avoimet huoltopyynnöt</SectionTitle>
      {open.length === 0 ? (
        <p className="text-sm text-ink/65">Ei avoimia pyyntöjä.</p>
      ) : (
        <ul className="divide-y divide-line">
          {open.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/huoltopyynnot/${r.id}`} className="min-w-0 truncate font-semibold hover:text-sky">
                {r.title}
              </Link>
              <span className="flex shrink-0 gap-1">
                <UrgencyBadge urgency={r.urgency} />
                <StatusBadge status={r.status} />
              </span>
            </li>
          ))}
          {open.length > 5 ? <li className="py-2 text-sm text-ink/60">ja {open.length - 5} muuta</li> : null}
        </ul>
      )}
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  const rows = await ctx.run((tx) => listPortalRequests(tx, ctx.user.id, { limit: 100 }));
  const mine = rows.filter((r) => r.mine && isOpen(r.status));
  // Valmiit odottavat ilmoittajan kuittausta, joten ne nostetaan ensin.
  const doneWaiting = rows.filter((r) => r.mine && r.status === "done");
  if (mine.length === 0 && doneWaiting.length === 0) return null;
  return (
    <Panel>
      <SectionTitle actions={<Link href="/portaali/huoltopyynnot" className="text-sm text-sky">Kaikki</Link>}>Omat huoltopyynnöt</SectionTitle>
      <ul className="divide-y divide-line">
        {[...doneWaiting, ...mine].slice(0, 5).map((r) => (
          <li key={r.id}>
            <Link href={`/portaali/huoltopyynnot/${r.id}`} className="flex min-h-[var(--size-touch)] items-center justify-between gap-3 py-2 hover:text-sky">
              <span className="min-w-0 truncate font-semibold">{r.title}</span>
              <StatusBadge status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
      {doneWaiting.length ? <p className="mt-2 text-sm text-ink/65">Kuittaa valmis pyyntö korjatuksi tai avaa se uudelleen.</p> : null}
    </Panel>
  );
}
