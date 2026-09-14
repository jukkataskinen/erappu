import Link from "next/link";
import { Badge, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { listOrders } from "@/lib/certificates/orders";
import { formatDate, formatDateTime } from "@/lib/format";
import { MEETING_KIND, MEETING_STATUS, MEETING_STATUS_TONE, type MeetingKind } from "@/lib/meetings/labels";
import { listMeetings, listPendingSignatures } from "@/lib/meetings/queries";

/**
 * Kokoukset ja todistukset (moduuli M5): työpöydän, taloyhtiön yleissivun ja
 * portaalin etusivun nostot.
 */

export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const orgId = ctx.org.organizationId;
  const [upcoming, pending, orders] = await ctx.run(async (tx) => {
    const meetings = await tx.query<{ id: string; company_id: string; company_name: string; kind: MeetingKind; starts_at: string; status: "draft" | "notice_sent" }>(
      `select m.id, m.company_id, c.name as company_name, m.kind, m.starts_at, m.status
         from er_meetings m join er_housing_companies c on c.id = m.company_id
        where m.organization_id = $1 and m.status in ('draft', 'notice_sent')
          and m.starts_at >= date_trunc('day', now()) and m.starts_at < now() + interval '60 days'
        order by m.starts_at limit 8`,
      [orgId],
    );
    return Promise.all([meetings, listPendingSignatures(tx, orgId), listOrders(tx, orgId, { openOnly: true, limit: 50 })]);
  });
  const newOrders = orders.filter((o) => o.status === "new");
  if (upcoming.length === 0 && pending.length === 0 && orders.length === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/kokoukset" className="text-sm text-sky">Kokoukset</Link>}>Kokoukset ja todistukset</SectionTitle>
      {upcoming.length > 0 ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Seuraavat 60 päivää</p>
          <ul className="mb-4 divide-y divide-line">
            {upcoming.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/taloyhtiot/${m.company_id}/kokoukset/${m.id}`} className="min-w-0 hover:text-sky">
                  <span className="block truncate font-semibold">{m.company_name}</span>
                  <span className="text-sm text-ink/65">
                    {MEETING_KIND[m.kind]} · {formatDateTime(m.starts_at)}
                  </span>
                </Link>
                <Badge tone={MEETING_STATUS_TONE[m.status]}>{MEETING_STATUS[m.status]}</Badge>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {pending.length > 0 ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Pöytäkirjat allekirjoitettavana</p>
          <ul className="mb-4 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.meeting_id} className="py-2">
                <Link href={`/taloyhtiot/${p.company_id}/kokoukset/${p.meeting_id}#allekirjoitus`} className="hover:text-sky">
                  <span className="font-semibold">{p.company_name}</span>
                  <span className="text-sm text-ink/65">
                    {" "}
                    · {MEETING_KIND[p.kind].toLowerCase()} {formatDate(p.starts_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {orders.length > 0 ? (
        <Link href="/todistukset" className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 hover:border-ink/25">
          <span className="text-sm font-semibold">Isännöitsijäntodistukset</span>
          <span className="flex gap-1">
            {newOrders.length ? <Badge tone="alert">{newOrders.length} uutta</Badge> : null}
            {orders.length - newOrders.length ? <Badge tone="warn">{orders.length - newOrders.length} työn alla</Badge> : null}
          </span>
        </Link>
      ) : null}
    </Panel>
  );
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const [next, minutes] = await ctx.run(async (tx) =>
    Promise.all([
      listMeetings(tx, { companyId, scope: "upcoming", limit: 1 }),
      tx.query<{ id: string; title: string; sealed: boolean; created_at: string }>(
        `select id, title, sealed, created_at from er_documents
          where company_id = $1 and category = 'minutes' and subject_table = 'er_meetings'
          order by sealed desc, created_at desc limit 1`,
        [companyId],
      ),
    ]),
  );
  const meeting = next[0];
  const doc = minutes[0];
  return (
    <Panel>
      <SectionTitle actions={<Link href={`/taloyhtiot/${companyId}/kokoukset`} className="text-sm text-sky">Kokoukset</Link>}>Kokoukset</SectionTitle>
      {meeting ? (
        <Link href={`/taloyhtiot/${companyId}/kokoukset/${meeting.id}`} className="block hover:text-sky">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Seuraava kokous</span>
          <span className="block font-semibold">{MEETING_KIND[meeting.kind]}</span>
          <span className="text-sm text-ink/65">
            {formatDateTime(meeting.starts_at)} · {MEETING_STATUS[meeting.status].toLowerCase()}
          </span>
        </Link>
      ) : (
        <p className="text-sm text-ink/65">Ei tulevia kokouksia.</p>
      )}
      {doc ? (
        <div className="mt-3 border-t border-line pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Viimeisin pöytäkirja</span>
          <a href={`/api/dokumentit/${doc.id}`} className="block font-semibold hover:text-sky">
            {doc.title}
          </a>
          {doc.sealed ? <Badge tone="ok">Allekirjoitettu</Badge> : <span className="text-xs text-ink/55">Luonnos {formatDate(doc.created_at)}</span>}
        </div>
      ) : null}
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  const upcoming = await ctx.run((tx) => listMeetings(tx, { scope: "upcoming", limit: 10 }));
  const next = upcoming.find((m) => m.kind !== "board");
  if (!next) return null;
  return (
    <Panel>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Seuraava yhtiökokous</p>
      <p className="mt-1 font-semibold">{MEETING_KIND[next.kind]}</p>
      <p className="text-sm text-ink/70">
        {next.company_name} · {formatDateTime(next.starts_at)}
        {next.location ? ` · ${next.location}` : ""}
      </p>
      <Link href="/portaali/kokoukset" className="mt-2 inline-block text-sm font-semibold text-sky">
        Kutsu ja asialista
      </Link>
    </Panel>
  );
}
