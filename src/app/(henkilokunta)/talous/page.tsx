import Link from "next/link";
import { Badge, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { RUN_STATUS, formatPrice } from "@/lib/finance/labels";
import { financeOverview, sumEur } from "@/lib/finance/queries";

export const metadata = { title: "Talous" };

export default async function FinanceOverviewPage() {
  const ctx = await requireStaff();
  const today = isoDateHelsinki();
  const rows = await ctx.run((tx) => financeOverview(tx, ctx.org.organizationId, today));
  const month = `${Number(today.slice(5, 7))}/${today.slice(0, 4)}`;
  const accrual = sumEur(rows.map((r) => r.monthlyAccrual));
  const open = sumEur(rows.map((r) => r.openEur));
  const overdue = sumEur(rows.map((r) => r.overdueEur));
  const missingRuns = rows.filter((r) => !r.currentRunDone && Number(r.monthlyAccrual) > 0).length;

  return (
    <>
      <PageHeader title="Talous" subtitle="Vastikkeet, laskutusajot ja maksutilanne yhtiöittäin. Kirjanpito on Procountorissa, joten ajot viedään CSV-tiedostona." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Vastikekertymä ${month}`} value={formatEur(accrual)} />
        <Stat label={`Laskutusajo tekemättä ${month}`} value={missingRuns} tone={missingRuns ? "warn" : "ok"} />
        <Stat label="Avoimet saatavat" value={formatEur(open)} />
        <Stat label="Erääntyneet saatavat" value={formatEur(overdue)} tone={Number(overdue) > 0 ? "alert" : undefined} />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="Ei taloyhtiöitä">Lisää taloyhtiöt rekisteriin ennen talouden tietoja.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Yhtiö</Th>
                <Th numeric>Hoitovastike</Th>
                <Th numeric>Kertymä {month}</Th>
                <Th numeric>Avoimet saatavat</Th>
                <Th numeric>Lainat</Th>
                <Th>Viimeisin laskutusajo</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-cloud/50">
                  <Td>
                    <Link href={`/taloyhtiot/${r.id}/talous`} className="font-semibold hover:text-sky">
                      {r.name}
                    </Link>
                    {!r.hasSettings ? <p className="text-xs text-amber">Laskutusasetukset puuttuvat</p> : null}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {r.maintenanceRate ? `${formatPrice(r.maintenanceRate)} €/m²/kk` : "–"}
                  </Td>
                  <Td numeric>{formatEur(r.monthlyAccrual)}</Td>
                  <Td numeric>
                    {r.asOf ? (
                      <>
                        {formatEur(r.openEur)}
                        {Number(r.overdueEur) > 0 ? <span className="block text-xs text-coral">erääntynyt {formatEur(r.overdueEur)}</span> : null}
                        <span className="block text-xs text-ink/50">{formatDate(r.asOf)}</span>
                      </>
                    ) : (
                      <span className="text-ink/50">ei tuotu</span>
                    )}
                  </Td>
                  <Td numeric>{Number(r.loansEur) > 0 ? formatEur(r.loansEur) : "–"}</Td>
                  <Td>
                    {r.latestRun ? (
                      <Link href={`/taloyhtiot/${r.id}/talous/ajot/${r.latestRun.id}`} className="flex flex-wrap items-center gap-2 hover:text-sky">
                        <span>
                          {Number(r.latestRun.period_start.slice(5, 7))}/{r.latestRun.period_start.slice(0, 4)}
                        </span>
                        <Badge tone={RUN_STATUS[r.latestRun.status].tone}>{RUN_STATUS[r.latestRun.status].label}</Badge>
                      </Link>
                    ) : (
                      <span className="text-ink/50">ei ajoja</span>
                    )}
                    {!r.currentRunDone && Number(r.monthlyAccrual) > 0 ? <p className="text-xs text-amber">Kuluvan kuun ajo tekemättä</p> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
