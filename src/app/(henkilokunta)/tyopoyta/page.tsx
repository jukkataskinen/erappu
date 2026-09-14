import Link from "next/link";
import { Badge, Notice, PageHeader, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listCompanies } from "@/lib/registry/queries";
import * as huolto from "@/widgets/huolto";
import * as htj from "@/widgets/htj";
import * as talous from "@/widgets/talous";
import * as viestinta from "@/widgets/viestinta";
import * as kokoukset from "@/widgets/kokoukset";
import * as arki from "@/widgets/arki";

export const metadata = { title: "Työpöytä" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("fi-FI", { hour: "numeric", hour12: false, timeZone: "Europe/Helsinki" }).format(new Date()));
  if (h < 10) return "Hyvää huomenta";
  if (h < 17) return "Hyvää päivää";
  return "Hyvää iltaa";
}

export default async function DashboardPage() {
  const ctx = await requireStaff();
  const companies = await ctx.run((tx) => listCompanies(tx, ctx.org.organizationId));
  const withIssues = companies.filter((c) => c.missing_ranges > 0 || (c.total_shares !== null && c.total_shares !== c.shares_in_units));
  const withoutHtj = companies.filter((c) => !c.htj_synced_at);
  const units = companies.reduce((s, c) => s + c.apartment_count, 0);
  const firstName = ctx.user.fullName?.split(" ")[0];

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} subtitle={ctx.org.organizationName} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Taloyhtiöt" value={companies.length} href="/taloyhtiot" />
        <Stat label="Asuinhuoneistot" value={units} href="/taloyhtiot" />
        <Stat label="Osakkeissa korjattavaa" value={withIssues.length} tone={withIssues.length ? "alert" : "ok"} href="/taloyhtiot" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <huolto.StaffDashboardWidget ctx={ctx} />
        <htj.StaffDashboardWidget ctx={ctx} />
        <talous.StaffDashboardWidget ctx={ctx} />
        <kokoukset.StaffDashboardWidget ctx={ctx} />
        <arki.StaffDashboardWidget ctx={ctx} />
        <viestinta.StaffDashboardWidget ctx={ctx} />

        {withIssues.length > 0 ? (
          <Panel>
            <SectionTitle>Osakeluettelon korjaukset</SectionTitle>
            <p className="mb-3 text-sm text-ink/65">Osakevälit tai osakemäärä eivät täsmää. Korjaa yhtiöjärjestyksen mukaan ennen HTJ-vertailua.</p>
            <ul className="divide-y divide-line">
              {withIssues.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/taloyhtiot/${c.id}/huoneistot`} className="font-semibold hover:text-sky">
                    {c.name}
                  </Link>
                  <Badge tone="alert">{c.missing_ranges > 0 ? `${c.missing_ranges} ilman osakenumeroita` : "osakemäärä ei täsmää"}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {withoutHtj.length > 0 ? (
          <Panel>
            <SectionTitle>HTJ-yhteys puuttuu</SectionTitle>
            <Notice tone="warn" title={`${withoutHtj.length}/${companies.length} yhtiötä ilman HTJ-synkronointia`}>
              Omistajatiedot ovat käsin tai Accessista tuotuja, kunnes yhtiö on haettu HTJ:stä.
            </Notice>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
