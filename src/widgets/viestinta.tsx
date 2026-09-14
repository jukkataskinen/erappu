import Link from "next/link";
import { Badge, Notice, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listPortalAnnouncements } from "@/lib/announcements/queries";
import { ANNOUNCEMENT_STATUS } from "@/lib/announcements/labels";
import { companyMissingBasics } from "@/lib/documents/queries";

/**
 * Tiedotteet ja dokumentit (moduuli M4): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */
export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const { drafts, failed } = await ctx.run(async (tx) => {
    const drafts = await tx.query<{ id: string; title: string; company_name: string; created_at: string }>(
      `select a.id, a.title, c.name as company_name, a.created_at
         from er_announcements a join er_housing_companies c on c.id = a.company_id
        where a.organization_id = $1 and a.status = 'draft' and a.origin = 'board'
        order by a.created_at limit 5`,
      [ctx.org.organizationId],
    );
    const [f] = await tx.query<{ failed: number }>(
      "select count(*)::int as failed from er_outbound_messages where organization_id = $1 and status = 'failed'",
      [ctx.org.organizationId],
    );
    return { drafts, failed: f.failed };
  });
  if (drafts.length === 0 && failed === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/tiedotteet" className="text-sm text-sky">Tiedotteet</Link>}>Viestintä</SectionTitle>
      {failed > 0 ? (
        <div className="mb-3">
          <Notice tone="alert" title={`${failed} sähköpostia epäonnistui`}>
            <Link href="/tiedotteet/lahetykset?tila=failed" className="text-sky">
              Tarkista lähetykset
            </Link>
          </Notice>
        </div>
      ) : null}
      {drafts.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-ink/65">Hallituksen luonnokset odottavat julkaisua</p>
          <ul className="divide-y divide-line">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/tiedotteet/${d.id}`} className="min-w-0 font-semibold hover:text-sky">
                  {d.title}
                  <span className="block text-xs font-normal text-ink/55">{d.company_name}</span>
                </Link>
                <span className="shrink-0 text-xs text-ink/55">{formatDate(d.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const { latest, missing } = await ctx.run(async (tx) => ({
    latest: await tx.query<{ id: string; title: string; status: keyof typeof ANNOUNCEMENT_STATUS; published_at: string | null; created_at: string }>(
      `select id, title, status, published_at, created_at from er_announcements
        where company_id = $1 and status <> 'archived'
        order by coalesce(published_at, created_at) desc limit 3`,
      [companyId],
    ),
    missing: await companyMissingBasics(tx, companyId),
  }));

  return (
    <Panel>
      <SectionTitle actions={<Link href={`/tiedotteet/uusi?yhtio=${companyId}`} className="text-sm text-sky">Uusi tiedote</Link>}>Tiedotteet ja dokumentit</SectionTitle>
      {latest.length === 0 ? (
        <p className="text-sm text-ink/65">Yhtiölle ei ole julkaistu tiedotteita.</p>
      ) : (
        <ul className="divide-y divide-line">
          {latest.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/tiedotteet/${a.id}`} className="min-w-0 truncate font-semibold hover:text-sky">
                {a.title}
              </Link>
              {a.status === "draft" ? <Badge tone="warn">Luonnos</Badge> : <span className="shrink-0 text-xs text-ink/55">{formatDate(a.published_at)}</span>}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 ? (
        <div className="mt-4">
          <Notice tone="warn" title="Perusdokumenteista puuttuu">
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m.category}>{m.reason}</li>
              ))}
            </ul>
            <Link href={`/taloyhtiot/${companyId}/dokumentit`} className="mt-1 inline-block text-sky">
              Dokumentit
            </Link>
          </Notice>
        </div>
      ) : null}
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  const companyIds = ctx.companies.map((c) => c.id);
  if (companyIds.length === 0) return null;
  const unread = await ctx.run((tx) => listPortalAnnouncements(tx, ctx.user.id, companyIds, { unreadOnly: true, limit: 3 }));
  if (unread.length === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/portaali/tiedotteet" className="text-sm text-sky">Kaikki</Link>}>Uudet tiedotteet</SectionTitle>
      <ul className="divide-y divide-line">
        {unread.map((a) => (
          <li key={a.id}>
            <Link href={`/portaali/tiedotteet/${a.id}`} className="flex min-h-[var(--size-touch)] items-center justify-between gap-3 py-2 hover:text-sky">
              <span className="min-w-0">
                <span className="block font-semibold">{a.title}</span>
                <span className="block text-xs text-ink/55">
                  {ctx.companies.length > 1 ? `${a.company_name} · ` : ""}
                  {formatDate(a.published_at)}
                </span>
              </span>
              <Badge tone="info">Uusi</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
