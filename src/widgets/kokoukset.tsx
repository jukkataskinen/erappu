import Link from "next/link";
import { Badge, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { listOrders } from "@/lib/certificates/orders";
import { formatDate, formatDateTime, isoDateHelsinki } from "@/lib/format";
import { MEETING_KIND, MEETING_STATUS, type MeetingKind } from "@/lib/meetings/labels";
import { listMeetings, listPendingSignatures } from "@/lib/meetings/queries";
import type { DashboardItem, DashboardSource } from "@/lib/dashboard/items";
import { resolveGoverningAct } from "@/lib/meetings/governing-act";
import { noticeWindow } from "@/lib/meetings/templates";
import { isGeneralMeeting } from "@/lib/meetings/labels";

/**
 * Kokoukset ja todistukset (moduuli M5): työpöydän, taloyhtiön yleissivun ja
 * portaalin etusivun nostot.
 */

/**
 * Työpöydän rivit: seuraavan 60 päivän kokoukset aikajanalle, lähettämättömien
 * kutsujen viimeinen päivä (yhtiökokous: AOYL 6:20 § kaksi viikkoa, OYL 5:19 §
 * viikko; hallitus: viikkoa ennen), lähettämättömät allekirjoituskierrokset ja
 * avoimet todistustilaukset.
 */
export async function dashboardItems(ctx: StaffContext): Promise<DashboardSource> {
  const orgId = ctx.org.organizationId;
  const [meetings, pending, orders] = await ctx.run(async (tx) =>
    Promise.all([
      tx.query<{ id: string; company_id: string; company_name: string; kind: MeetingKind; starts_at: string; status: "draft" | "notice_sent"; company_form: string; governing_act: string | null }>(
        `select m.id, m.company_id, c.name as company_name, m.kind, m.starts_at, m.status, c.company_form, c.governing_act
           from er_meetings m join er_housing_companies c on c.id = m.company_id
          where m.organization_id = $1 and m.status in ('draft', 'notice_sent')
            and m.starts_at >= date_trunc('day', now()) and m.starts_at < now() + interval '61 days'
          order by m.starts_at`,
        [orgId],
      ),
      listPendingSignatures(tx, orgId),
      listOrders(tx, orgId, { openOnly: true, limit: 50 }),
    ]),
  );
  const items: DashboardItem[] = [];
  for (const m of meetings) {
    const iso = new Date(m.starts_at).toISOString();
    const day = isoDateHelsinki(new Date(m.starts_at));
    const href = `/taloyhtiot/${m.company_id}/kokoukset/${m.id}`;
    items.push({ id: `kokous-${m.id}`, category: "kokous", title: MEETING_KIND[m.kind], companyId: m.company_id, companyName: m.company_name, context: formatDateTime(m.starts_at), href, action: "Avaa", dueOn: day, event: true });
    if (m.status === "draft") {
      const general = isGeneralMeeting(m.kind);
      const minDays = general ? (resolveGoverningAct(m.company_form, m.governing_act) === "oyl" ? 7 : 14) : 7;
      items.push({
        id: `kutsu-${m.id}`,
        category: "kokous",
        title: general ? "Yhtiökokouskutsu viimeistään" : "Hallituksen kokouskutsu ja asialista",
        companyId: m.company_id,
        companyName: m.company_name,
        context: `${MEETING_KIND[m.kind].toLowerCase()} ${formatDate(day)}`,
        href,
        action: "Lähetä kutsu",
        dueOn: noticeWindow(iso, minDays).latest,
      });
    }
  }
  for (const p of pending.filter((x) => x.status === "draft")) {
    items.push({
      id: `allekirjoitus-${p.meeting_id}`,
      category: "allekirjoitus",
      title: "Pöytäkirjan allekirjoituskierros lähettämättä",
      companyId: p.company_id,
      companyName: p.company_name,
      context: `${MEETING_KIND[p.kind].toLowerCase()} ${formatDate(p.starts_at)}`,
      href: `/taloyhtiot/${p.company_id}/kokoukset/${p.meeting_id}#allekirjoitus`,
      action: "Lähetä",
      dueOn: null,
      waiting: true,
      since: isoDateHelsinki(new Date(p.created_at)),
    });
  }
  for (const o of orders) {
    items.push({
      id: `todistus-${o.id}`,
      category: "todistus",
      title: `Isännöitsijäntodistus${o.express ? ", pikatilaus" : ""}`,
      companyId: o.company_id,
      companyName: o.company_name,
      context: `huoneisto ${o.unit_label} · tilaaja ${o.orderer_name}${o.status === "in_progress" ? " · työn alla" : ""}`,
      href: `/todistukset/${o.id}`,
      action: o.status === "new" ? "Aloita" : "Jatka",
      dueOn: null,
      waiting: true,
      since: isoDateHelsinki(new Date(o.created_at)),
    });
  }
  return { items };
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
