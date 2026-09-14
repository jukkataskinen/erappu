import Link from "next/link";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { Badge, Panel, SectionTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { StatusBadge, UrgencyBadge } from "@/lib/service-requests/components/parts";
import { listPortalRequests, listRequests } from "@/lib/service-requests/queries";
import { isOpen } from "@/lib/service-requests/status";

/**
 * Huoltopyynnöt (moduuli M1): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */
export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const open = await ctx.run((tx) => listRequests(tx, ctx.org.organizationId, { openOnly: true, limit: 500 }));
  const urgent = open.filter((r) => r.urgency === "urgent").length;
  const fresh = open.filter((r) => r.status === "new").length;
  const overdue = open.filter((r) => r.overdue);
  // Lista on jo järjestetty kiireellisyyden ja saapumisajan mukaan.
  const top = [...overdue, ...open.filter((r) => !r.overdue)].slice(0, 6);

  return (
    <Panel>
      <SectionTitle actions={<Link href="/huoltopyynnot" className="text-sm text-sky">Työjono</Link>}>Huoltopyynnöt</SectionTitle>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Badge tone={open.length ? "info" : "ok"}>{open.length} avointa</Badge>
        {fresh ? <Badge tone="alert">{fresh} uutta</Badge> : null}
        {urgent ? <Badge tone="alert">{urgent} kiireellistä</Badge> : null}
        {overdue.length ? <Badge tone="warn">{overdue.length} myöhässä</Badge> : null}
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-ink/65">Ei avoimia huoltopyyntöjä.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <Link href={`/huoltopyynnot/${r.id}`} className="block truncate font-semibold hover:text-sky">
                  {r.title}
                </Link>
                <span className="text-xs text-ink/55">
                  {r.company_name} · {formatDate(r.created_at)}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {r.overdue ? <Badge tone="warn">Myöhässä</Badge> : null}
                <UrgencyBadge urgency={r.urgency} />
                <StatusBadge status={r.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
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
