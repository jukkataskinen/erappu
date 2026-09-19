import Link from "next/link";
import { Panel, SectionTitle } from "@/components/ui";
import type { PortalContext, StaffContext } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { formatPrice } from "@/lib/finance/labels";
import { financeOverview, getBillingSettings, listLoans, listUnitFinance, loadChargeBases, maintenanceRate, sumEur } from "@/lib/finance/queries";
import { ownerUnitFinance } from "@/lib/finance/portal";
import type { DashboardItem, DashboardSource, HealthRow } from "@/lib/dashboard/items";
import { addDays, addMonths } from "@/lib/tasks/dates";

/**
 * Talous (moduuli M3): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot.
 */
/** Vastikeajo tehdään viimeistään näin monta päivää ennen eräpäivää (laskujen toimitus). */
const BILLING_LEAD_DAYS = 10;

/**
 * Työpöydän rivit: luonnoksena olevat vastikeajot ja seuraavan laskutettavan
 * kuukauden tekemättömät ajot (ryhmitellään yhdeksi riviksi). Laskutettava
 * kuukausi on kuluva kuukausi eräpäivään asti, sen jälkeen seuraava.
 * Erääntyneet saatavat ovat tietojen kuntoa.
 */
export async function dashboardItems(ctx: StaffContext): Promise<DashboardSource> {
  const today = isoDateHelsinki();
  const { overview, drafts, dueDays, runs } = await ctx.run(async (tx) => ({
    overview: await financeOverview(tx, ctx.org.organizationId, today),
    drafts: await tx.query<{ id: string; company_id: string; company_name: string; period_start: string; kind: string }>(
      `select r.id, r.company_id, c.name as company_name, r.period_start::text, r.kind
         from er_billing_runs r join er_housing_companies c on c.id = r.company_id
        where r.organization_id = $1 and r.status = 'draft' order by r.period_start, c.name`,
      [ctx.org.organizationId],
    ),
    dueDays: new Map(
      (await tx.query<{ company_id: string; due_day: number }>("select company_id, due_day from er_company_billing_settings where organization_id = $1", [ctx.org.organizationId])).map(
        (s) => [s.company_id, s.due_day],
      ),
    ),
    runs: new Set(
      (await tx.query<{ key: string }>(
        `select company_id || ':' || to_char(period_start, 'YYYY-MM') as key from er_billing_runs
          where organization_id = $1 and status <> 'cancelled' and kind = 'charges' and period_start >= date_trunc('month', $2::date)`,
        [ctx.org.organizationId, today],
      )).map((r) => r.key),
    ),
  }));
  const target = (companyId: string) => {
    const day = String(dueDays.get(companyId) ?? 5).padStart(2, "0");
    const current = `${today.slice(0, 8)}${day}`;
    const due = today <= current ? current : addMonths(current, 1);
    return { month: due.slice(0, 7), due };
  };
  const missing = overview
    .filter((c) => Number(c.monthlyAccrual) > 0)
    .map((c) => ({ c, t: target(c.id) }))
    .filter(({ c, t }) => !runs.has(`${c.id}:${t.month}`));
  const items: DashboardItem[] = [
    ...drafts.map((d) => ({
      id: `ajo-${d.id}`,
      category: "talous" as const,
      title: `${d.kind === "water_settlement" ? "Vesitasaus" : `Vastikeajo ${Number(d.period_start.slice(5, 7))}/${d.period_start.slice(0, 4)}`} luonnoksena`,
      companyId: d.company_id,
      companyName: d.company_name,
      href: `/taloyhtiot/${d.company_id}/talous/ajot/${d.id}`,
      action: "Tarkista",
      dueOn: null,
      waiting: true,
    })),
    ...missing.map(({ c, t }) => {
      const month = `${Number(t.month.slice(5, 7))}/${t.month.slice(0, 4)}`;
      return {
        id: `ajo-puuttuu-${c.id}`,
        category: "talous" as const,
        title: `Vastikeajo ${month} tekemättä`,
        companyId: c.id,
        companyName: c.name,
        href: `/taloyhtiot/${c.id}/talous`,
        action: "Vastikeajot",
        context: `eräpäivä ${Number(t.due.slice(8))}.${Number(t.due.slice(5, 7))}.`,
        dueOn: addDays(t.due, -BILLING_LEAD_DAYS),
        group: { key: `ajo-puuttuu-${t.month}`, href: "/talous" },
      };
    }),
  ];
  const overdue = overview.filter((c) => Number(c.overdueEur ?? 0) > 0);
  const health: HealthRow[] = [
    { key: "saatavat", label: "Erääntyneitä vastikesaatavia", companies: overdue.map((c) => ({ id: c.id, name: c.name })), href: "/talous", tone: "neutral" },
  ];
  return { items, health, billingMissing: missing.map(({ c }) => c.id) };
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
