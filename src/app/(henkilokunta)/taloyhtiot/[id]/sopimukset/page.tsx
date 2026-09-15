import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { LinkButton } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { ContractsView, type ContractsSearch } from "../../../sopimukset/ContractsView";

export const metadata = { title: "Sopimukset" };

export default async function CompanyContractsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ContractsSearch> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;
  return (
    <ContractsView
      ctx={ctx}
      sp={sp}
      fixedCompanyId={company.id}
      basePath={`/taloyhtiot/${company.id}/sopimukset`}
      header={({ newHref, canWrite }) => (
        <CompanyHeader
          company={company}
          active="sopimukset"
          actions={
            <>
              <LinkButton variant="secondary" href="/sopimukset/erat">Massaluonti</LinkButton>
              {canWrite ? <LinkButton href={newHref}>Lisää sopimus</LinkButton> : null}
            </>
          }
        />
      )}
    />
  );
}
