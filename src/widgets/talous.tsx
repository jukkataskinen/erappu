import Link from "next/link";
import { Badge, Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { formatPrice } from "@/lib/finance/labels";
import { financeOverview, getBillingSettings, listLoans, listUnitFinance, loadChargeBases, maintenanceRate, sumEur } from "@/lib/finance/queries";
import { ownerUnitFinance } from "@/lib/finance/portal";

/**
 * Talous (moduuli M3): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot.
 */
export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  const today = isoDateHelsinki();
  const rows = await ctx.run(async (tx) => {
    const overview = await financeOverview(tx, ctx.org.organizationId, today);
    const drafts = await tx.query<{ id: string; company_id: string; company_name: string; period_start: string }>(
      `select r.id, r.company_id, c.name as company_name, r.period_start::text
         from er_billing_runs r join er_housing_companies c on c.id = r.company_id
        where r.organization_id = $1 and r.status = 'draft' order by r.period_start, c.name`,
      [ctx.org.organizationId],
    );
    return { overview, drafts };
  });
  const { overview, drafts } = rows;
  if (overview.length === 0) return null;
  const missing = overview.filter((c) => !c.currentRunDone && Number(c.monthlyAccrual) > 0);
  const overdue = sumEur(overview.map((c) => c.overdueEur));
  const month = `${Number(today.slice(5, 7))}/${today.slice(0, 4)}`;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/talous" className="text-sm text-sky">Talous</Link>}>Talous</SectionTitle>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className={`tabular text-xl font-bold ${drafts.length ? "text-amber" : ""}`}>{drafts.length}</p>
          <p className="text-xs text-ink/60">ajoa luonnoksena</p>
        </div>
        <div>
          <p className={`tabular text-xl font-bold ${missing.length ? "text-amber" : "text-moss"}`}>{missing.length}</p>
          <p className="text-xs text-ink/60">ajoa tekemättä {month}</p>
        </div>
        <div>
          <p className={`tabular text-xl font-bold ${Number(overdue) > 0 ? "text-coral" : ""}`}>{formatEur(overdue)}</p>
          <p className="text-xs text-ink/60">erääntyneet saatavat</p>
        </div>
      </div>
      {drafts.length > 0 || missing.length > 0 ? (
        <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
          {drafts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/taloyhtiot/${d.company_id}/talous/ajot/${d.id}`} className="font-semibold hover:text-sky">
                {d.company_name}
              </Link>
              <Badge tone="warn">
                Luonnos {Number(d.period_start.slice(5, 7))}/{d.period_start.slice(0, 4)}
              </Badge>
            </li>
          ))}
          {missing.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/taloyhtiot/${c.id}/talous`} className="font-semibold hover:text-sky">
                {c.name}
              </Link>
              <Badge>Ajo tekemättä</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  const today = isoDateHelsinki();
  const data = await ctx.run(async (tx) => {
    const settings = await getBillingSettings(tx, companyId);
    const bases = await loadChargeBases(tx, companyId);
    const [loans, units] = await Promise.all([listLoans(tx, companyId), listUnitFinance(tx, companyId, today, settings, bases)]);
    return { bases, loans, units };
  });
  const rate = maintenanceRate(data.bases, today);
  const loans = sumEur(data.loans.map((l) => l.balance_eur ?? l.principal_eur));
  const withStatus = data.units.filter((u) => u.as_of);
  const asOf = withStatus.map((u) => u.as_of!).sort().at(-1);
  const open = sumEur(withStatus.map((u) => u.open_eur));
  const overdue = sumEur(withStatus.map((u) => u.overdue_eur));
  if (!rate && data.loans.length === 0 && !asOf && data.bases.length === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href={`/taloyhtiot/${companyId}/talous`} className="text-sm text-sky">Talous</Link>}>Talous</SectionTitle>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink/65">Hoitovastike</dt>
          <dd className="tabular font-semibold">{rate ? `${formatPrice(rate)} €/m²/kk` : "–"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/65">Lainat yhteensä</dt>
          <dd className="tabular font-semibold">{data.loans.length ? formatEur(loans) : "–"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/65">Avoimet saatavat{asOf ? ` ${formatDate(asOf)}` : ""}</dt>
          <dd className="tabular font-semibold">
            {asOf ? formatEur(open) : "–"}
            {Number(overdue) > 0 ? <span className="block text-right text-xs text-coral">erääntynyt {formatEur(overdue)}</span> : null}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  if (!ctx.user.portal.some((g) => g.role === "owner" && g.shareGroupId)) return null;
  const units = await ctx.run((tx) => ownerUnitFinance(tx, ctx.user.portal, isoDateHelsinki()));
  if (units.length === 0) return null;

  return (
    <Panel>
      <SectionTitle actions={<Link href="/portaali/talous" className="text-sm text-sky">Erittely</Link>}>Vastikkeet</SectionTitle>
      <ul className="divide-y divide-line">
        {units.map((u) => (
          <li key={u.shareGroupId} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {u.unitLabel} <span className="text-sm font-normal text-ink/55">{u.companyName}</span>
              </span>
              <span className="tabular font-semibold">{formatEur(u.monthlyTotal)}/kk</span>
            </div>
            {u.payment ? (
              Number(u.payment.overdueEur) > 0 ? (
                <p className="text-sm text-coral">Erääntynyt {formatEur(u.payment.overdueEur)} ({formatDate(u.payment.asOf)})</p>
              ) : (
                <p className="text-sm text-ink/60">Ei erääntyneitä vastikkeita {formatDate(u.payment.asOf)}</p>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
