import { notFound } from "next/navigation";
import { Badge, PageHeader, Tabs } from "@/components/ui";
import { companyTabs, type CompanyTabKey } from "@/config/company-tabs";
import type { StaffContext } from "@/lib/auth/current-user";
import { getCompany, type Company } from "@/lib/registry/queries";
import { COMPANY_FORM } from "@/lib/registry/labels";
import type { ReactNode } from "react";

/**
 * Taloyhtiösivujen yhteinen otsikko ja välilehdet. Palauttaa yhtiön, jotta
 * sivu ei hae sitä toiseen kertaan. Toisen organisaation yhtiö → 404 (RLS).
 */
export async function loadCompany(ctx: StaffContext, companyId: string): Promise<Company> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  const company = await ctx.run((tx) => getCompany(tx, companyId));
  if (!company) notFound();
  return company;
}

export function CompanyHeader({ company, active, actions }: { company: Company; active: CompanyTabKey; actions?: ReactNode }) {
  return (
    <>
      <PageHeader
        back={{ href: "/taloyhtiot", label: "Taloyhtiöt" }}
        title={company.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{company.business_id}</span>
            <span aria-hidden>·</span>
            <span>{COMPANY_FORM[company.company_form]}</span>
            {company.city ? (
              <>
                <span aria-hidden>·</span>
                <span>{company.city}</span>
              </>
            ) : null}
            {company.htj_synced_at ? <Badge tone="ok">HTJ synkronoitu</Badge> : <Badge tone="warn">Ei HTJ-yhteyttä</Badge>}
          </span>
        }
        actions={actions}
      />
      <Tabs items={companyTabs(company.id)} active={active} />
    </>
  );
}
