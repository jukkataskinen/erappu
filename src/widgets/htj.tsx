import Link from "next/link";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { Badge, LinkButton, Panel, SectionTitle } from "@/components/ui";
import { formatDate, formatDateTime, isoDateHelsinki } from "@/lib/format";
import { REPORT_STATE_LABEL } from "@/lib/htj/htj2";
import { OBLIGATION_LABEL } from "@/lib/htj/obligation";
import { companyHtjOverview, listHtjOverview } from "@/lib/htj/queries";
import { workSummary } from "@/lib/maintenance/notice-form";
import { listPortalNotices } from "@/lib/maintenance/queries";
import { OPEN_FOR_COMPANY, OPEN_FOR_OWNER, RENOVATION_STATUS_LABEL, RENOVATION_STATUS_TONE } from "@/lib/maintenance/renovation";

/**
 * HTJ ja korjaushistoria (moduuli M2): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */

const reported = (s: string) => s === "sent" || s === "manual_done";

export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const [rows, notices] = await ctx.run(async (tx) => [
    await listHtjOverview(tx, ctx.org.organizationId, isoDateHelsinki()),
    await tx.query<{ id: string; company_id: string; company_name: string; unit_label: string; status: "received" | "info_requested"; created_at: string }>(
      `select n.id, n.company_id, c.name as company_name, g.unit_label, n.status, n.created_at::text
         from er_renovation_notices n join er_housing_companies c on c.id = n.company_id join er_share_groups g on g.id = n.share_group_id
        where n.organization_id = $1 and n.status = any($2::text[]) order by n.created_at limit 6`,
      [ctx.org.organizationId, OPEN_FOR_COMPANY],
    ),
  ] as const);
  if (rows.length === 0 && notices.length === 0) return null;

  const mandatoryOpen = rows.filter((r) => r.obligation.level === "mandatory" && !reported(r.state));
  const withDiffs = rows.filter((r) => r.pendingDiffs > 0);

  return (
    <Panel>
      <SectionTitle actions={<Link href="/htj" className="text-sm text-sky">HTJ</Link>}>HTJ2-ilmoitukset ja muutostyöt</SectionTitle>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className={`tabular text-2xl font-bold ${mandatoryOpen.length ? "text-coral" : "text-moss"}`}>{mandatoryOpen.length}</p>
          <p className="text-xs text-ink/60">pakollista ilmoittamatta</p>
        </div>
        <div>
          <p className={`tabular text-2xl font-bold ${withDiffs.length ? "text-amber" : ""}`}>{withDiffs.reduce((s, r) => s + r.pendingDiffs, 0)}</p>
          <p className="text-xs text-ink/60">HTJ-eroa odottaa</p>
        </div>
        <div>
          <p className={`tabular text-2xl font-bold ${notices.length ? "text-coral" : ""}`}>{notices.length}</p>
          <p className="text-xs text-ink/60">muutostyöilmoitusta</p>
        </div>
      </div>
      {mandatoryOpen.length > 0 || withDiffs.length > 0 || notices.length > 0 ? (
        <ul className="mt-4 divide-y divide-line text-sm">
          {withDiffs.map((r) => (
            <li key={`d-${r.id}`} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/taloyhtiot/${r.id}/htj`} className="font-semibold hover:text-sky">
                {r.name}
              </Link>
              <Badge tone="warn">{r.pendingDiffs} HTJ-eroa</Badge>
            </li>
          ))}
          {notices.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/taloyhtiot/${n.company_id}/korjaukset/muutostyot/${n.id}`} className="hover:text-sky">
                <span className="font-semibold">{n.company_name}</span> {n.unit_label}
                <span className="block text-xs text-ink/55">Muutostyöilmoitus {formatDate(n.created_at)}</span>
              </Link>
              <Badge tone={RENOVATION_STATUS_TONE[n.status]}>{RENOVATION_STATUS_LABEL[n.status]}</Badge>
            </li>
          ))}
          {mandatoryOpen.slice(0, 5).map((r) => (
            <li key={`m-${r.id}`} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/taloyhtiot/${r.id}/htj/yhteenveto`} className="font-semibold hover:text-sky">
                {r.name}
              </Link>
              <span className="text-xs text-ink/60">{r.gaps.length ? `${r.gaps.length} puutetta` : REPORT_STATE_LABEL[r.state]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-moss">Ilmoitukset on tehty, eikä mikään odota käsittelyä.</p>
      )}
    </Panel>
  );
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const [o, [open]] = await ctx.run(async (tx) => [
    await companyHtjOverview(tx, companyId, isoDateHelsinki()),
    await tx.query<{ n: number }>("select count(*)::int as n from er_renovation_notices where company_id = $1 and status = any($2::text[])", [companyId, OPEN_FOR_COMPANY]),
  ] as const);
  if (!o) return null;
  const alerts = o.gaps.filter((g) => g.severity === "alert");

  return (
    <Panel>
      <SectionTitle actions={<Link href={`/taloyhtiot/${companyId}/htj`} className="text-sm text-sky">HTJ</Link>}>HTJ2-ilmoitukset</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={o.obligation.level === "mandatory" ? "alert" : "neutral"}>{OBLIGATION_LABEL[o.obligation.level]}</Badge>
        <Badge tone={reported(o.state) ? "ok" : o.state === "draft" ? "warn" : "neutral"}>{REPORT_STATE_LABEL[o.state]}</Badge>
        {o.pendingDiffs > 0 ? <Badge tone="warn">{o.pendingDiffs} HTJ-eroa</Badge> : null}
      </div>
      <p className="mt-2 text-sm text-ink/70">{o.obligation.reasons[0]}</p>
      {o.gaps.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink/75">
          {(alerts.length ? alerts : o.gaps).slice(0, 4).map((g) => (
            <li key={g.message}>{g.message}</li>
          ))}
          {o.gaps.length > 4 ? <li className="list-none text-xs text-ink/55">ja {o.gaps.length - 4} muuta</li> : null}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-ink/55">HTJ-vertailu: {o.syncedAt ? formatDateTime(o.syncedAt) : "ei tehty"}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link href={`/taloyhtiot/${companyId}/htj/yhteenveto`} className="font-semibold text-sky">
          Yhteenveto
        </Link>
        {open.n > 0 ? (
          <Link href={`/taloyhtiot/${companyId}/korjaukset`} className="font-semibold text-coral">
            {open.n} muutostyöilmoitusta käsittelemättä
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  const ownGroups = new Set(ctx.user.portal.filter((g) => (g.role === "owner" || g.role === "resident") && g.shareGroupId).map((g) => g.shareGroupId));
  const canSubmit = ctx.user.portal.some((g) => g.role === "owner" && g.shareGroupId);
  if (ownGroups.size === 0) return null;
  const notices = (await ctx.run((tx) => listPortalNotices(tx))).filter((n) => ownGroups.has(n.share_group_id) && OPEN_FOR_OWNER.includes(n.status));
  if (notices.length === 0 && !canSubmit) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/portaali/muutostyot" className="text-sm text-sky">Kaikki</Link>}>Muutostyöt</SectionTitle>
      {notices.length === 0 ? (
        <p className="text-sm text-ink/65">Suunnitteletko remonttia? Tee muutostyöilmoitus ennen työn aloittamista.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notices.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-semibold">{n.work_count > 0 ? workSummary(n.work_types, n.work_count) : n.work_type ?? "Muutostyö"}</span>
                <span className="block text-xs text-ink/55">
                  {n.unit_label} · {formatDate(n.created_at)}
                </span>
              </span>
              <Badge tone={RENOVATION_STATUS_TONE[n.status]}>{RENOVATION_STATUS_LABEL[n.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {canSubmit ? (
        <div className="mt-3">
          <LinkButton variant="secondary" href="/portaali/muutostyot/uusi" className="w-full sm:w-auto">
            Tee muutostyöilmoitus
          </LinkButton>
        </div>
      ) : null}
    </Panel>
  );
}
