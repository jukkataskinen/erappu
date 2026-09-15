import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { Badge, EmptyState, LinkButton, Notice, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatNumber } from "@/lib/format";
import { listShareGroups } from "@/lib/registry/queries";
import { SHARE_GROUP_KIND, SOURCE } from "@/lib/registry/labels";
import { checkCoverage, formatRanges } from "@/lib/registry/share-ranges";

export const metadata = { title: "Huoneistot" };

export default async function ShareGroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const groups = await ctx.run((tx) => listShareGroups(tx, id));
  const issues = checkCoverage(groups.map((g) => ({ unitLabel: g.unit_label, ranges: g.ranges })), company.total_shares);
  const problemUnits = new Set(issues.flatMap((i) => ("units" in i ? i.units : [])));
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <CompanyHeader company={company} active="huoneistot" actions={canWrite ? <LinkButton href={`/taloyhtiot/${id}/huoneistot/uusi`}>Lisää huoneisto</LinkButton> : null} />
      {issues.length > 0 ? (
        <div className="mb-5">
          <Notice tone="alert" title="Osakevälit eivät ole kunnossa">
            <ul className="list-disc pl-5">
              {issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : groups.length > 0 ? (
        <div className="mb-5">
          <Notice tone="ok" title="Osakevälit ovat yhtenäiset ja täsmäävät yhtiön osakemäärään" />
        </div>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState title="Ei huoneistoja">Lisää huoneistot käsin tai hae osakeryhmät HTJ:stä.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tunnus</Th>
              <Th>Tyyppi</Th>
              <Th numeric>m²</Th>
              <Th>Osakkeet</Th>
              <Th numeric>Kpl</Th>
              <Th>Omistajat</Th>
              <Th>Asukkaat</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="hover:bg-cloud/50">
                <Td>
                  <Link href={`/taloyhtiot/${id}/huoneistot/${g.id}`} className="font-semibold hover:text-sky">
                    {g.building_label ? `${g.building_label} ` : ""}
                    {g.unit_label}
                  </Link>
                  <div className="mt-0.5 flex gap-1">
                    <Badge tone={g.source === "htj" ? "ok" : "neutral"}>{SOURCE[g.source]}</Badge>
                    {g.is_rented ? <Badge tone="info">Vuokrattu</Badge> : null}
                  </div>
                </Td>
                <Td>
                  {SHARE_GROUP_KIND[g.kind]}
                  {g.layout ? <span className="block text-xs text-ink/55">{g.layout}</span> : null}
                  {g.floor_plan_id ? (
                    <a href={`/api/dokumentit/${g.floor_plan_id}`} target="_blank" rel="noopener" className="block text-xs text-sky hover:underline">
                      Pohjapiirustus
                    </a>
                  ) : null}
                </Td>
                <Td numeric>{formatNumber(g.area_m2)}</Td>
                <Td className={problemUnits.has(g.unit_label) ? "text-coral" : undefined}>{g.ranges.length ? formatRanges(g.ranges) : <span className="text-coral">puuttuu</span>}</Td>
                <Td numeric>{formatNumber(g.share_count)}</Td>
                <Td>{g.owners ?? <span className="text-ink/45">–</span>}</Td>
                <Td>{g.residents ?? <span className="text-ink/45">–</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
