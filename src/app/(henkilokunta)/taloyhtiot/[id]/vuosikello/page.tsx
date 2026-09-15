import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { LinkButton } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { AnnualCycleView, type AnnualCycleSearch } from "../../../vuosikello/AnnualCycleView";

export const metadata = { title: "Vuosikello" };

export default async function CompanyAnnualCyclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<AnnualCycleSearch> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;
  return (
    <AnnualCycleView
      ctx={ctx}
      sp={sp}
      fixedCompanyId={company.id}
      basePath={`/taloyhtiot/${company.id}/vuosikello`}
      header={({ newHref }) => <CompanyHeader company={company} active="vuosikello" actions={<LinkButton href={newHref}>Uusi tehtävä</LinkButton>} />}
    />
  );
}
