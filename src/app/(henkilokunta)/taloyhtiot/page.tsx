import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { hasShareIssues, listCompanies } from "@/lib/registry/queries";
import { formatNumber } from "@/lib/format";
import { GovernancePanel } from "./GovernancePanel";

export const metadata = { title: "Taloyhtiöt" };

export default async function CompaniesPage() {
  const ctx = await requireStaff();
  const companies = await ctx.run((tx) => listCompanies(tx, ctx.org.organizationId));
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader
        title="Taloyhtiöt"
        subtitle={`${companies.length} isännöitävää yhtiötä`}
        actions={canWrite ? <LinkButton href="/taloyhtiot/uusi">Lisää taloyhtiö</LinkButton> : null}
      />
      {companies.length === 0 ? (
        <EmptyState title="Ei vielä taloyhtiöitä" action={canWrite ? <LinkButton href="/taloyhtiot/uusi">Lisää ensimmäinen</LinkButton> : null}>
          Lisää yhtiö käsin tai tuo tiedot Accessista (<code>npm run access:import</code>).
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Yhtiö</Th>
              <Th>Paikkakunta</Th>
              <Th numeric>Huoneistot</Th>
              <Th numeric>Osakkeet</Th>
              <Th>Tila</Th>
              <Th>Isännöitsijä</Th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const sharesOk = !hasShareIssues(c);
              return (
                <tr key={c.id} className="row-link hover:bg-cloud/50">
                  <Td>
                    <Link href={`/taloyhtiot/${c.id}`} className="row-link-main font-semibold hover:text-sky">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink/55">{c.business_id}</p>
                  </Td>
                  <Td>{c.city ?? "–"}</Td>
                  <Td numeric>
                    {c.apartment_count}
                    {c.unit_count > c.apartment_count ? <span className="text-ink/50"> + {c.unit_count - c.apartment_count}</span> : null}
                  </Td>
                  <Td numeric>
                    {formatNumber(c.shares_in_units)}
                    {!c.share_checks_off && c.total_shares && c.total_shares !== c.shares_in_units ? <span className="block text-xs text-coral">yhtiössä {formatNumber(c.total_shares)}</span> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.share_checks_off ? <Badge tone="neutral">Omat säännöt</Badge> : sharesOk ? <Badge tone="ok">Osakkeet kunnossa</Badge> : <Badge tone="alert">Osakkeissa korjattavaa</Badge>}
                      {c.htj_synced_at ? <Badge tone="ok">HTJ</Badge> : <Badge tone="neutral">Ei HTJ</Badge>}
                    </div>
                  </Td>
                  <Td>{c.manager_name ?? "–"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {companies.length > 0 ? (
        <div className="mt-6">
          <GovernancePanel ctx={ctx} />
        </div>
      ) : null}
    </>
  );
}
