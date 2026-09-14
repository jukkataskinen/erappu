import Link from "next/link";
import { EmptyState, LinkButton, Panel, SectionTitle } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { StatusBadge, UrgencyBadge } from "@/lib/service-requests/components/parts";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { listPortalRequests, type PortalRequestRow } from "@/lib/service-requests/queries";

export const metadata = { title: "Huoltopyynnöt" };

function RequestList({ rows }: { rows: PortalRequestRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/portaali/huoltopyynnot/${r.id}`} className="flex min-h-[var(--size-touch)] flex-col gap-1 py-3 hover:text-sky">
            <span className="flex items-start justify-between gap-3">
              <span className="font-semibold">{r.title}</span>
              <StatusBadge status={r.status} />
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink/60">
              <span>#{r.number}</span>
              <span>{CATEGORY_LABEL[r.category]}</span>
              <span>
                {r.company_name}
                {r.unit_label ? `, ${r.unit_label}` : ""}
              </span>
              <span>{formatDate(r.created_at)}</span>
              <UrgencyBadge urgency={r.urgency} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function PortalRequestsPage() {
  const ctx = await requirePortal();
  const rows = await ctx.run((tx) => listPortalRequests(tx, ctx.user.id));
  const mine = rows.filter((r) => r.mine);
  const board = rows.filter((r) => !r.mine);
  const isBoard = ctx.companies.some((c) => c.roles.includes("board"));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Huoltopyynnöt</h1>
        <LinkButton href="/portaali/huoltopyynnot/uusi" className="w-full sm:w-auto">
          Tee huoltopyyntö
        </LinkButton>
      </div>

      <Panel className="mt-5">
        <SectionTitle>Omat pyynnöt</SectionTitle>
        {mine.length === 0 ? (
          <EmptyState title="Ei pyyntöjä">Kun teet huoltopyynnön, näet sen tilan ja isännöinnin viestit tässä.</EmptyState>
        ) : (
          <RequestList rows={mine} />
        )}
      </Panel>

      {isBoard ? (
        <Panel className="mt-5">
          <SectionTitle>Yhtiön pyynnöt (hallitus)</SectionTitle>
          {board.length === 0 ? <p className="text-sm text-ink/65">Ei muita pyyntöjä.</p> : <RequestList rows={board} />}
        </Panel>
      ) : null}
    </>
  );
}
