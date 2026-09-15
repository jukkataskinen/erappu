import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { requireStaff } from "@/lib/auth/current-user";
import { ConsumptionView, type ConsumptionSearch } from "../../../kulutus/ConsumptionView";

export const metadata = { title: "Kulutusseuranta" };

export default async function CompanyConsumptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ConsumptionSearch> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;
  return (
    <ConsumptionView
      ctx={ctx}
      sp={sp}
      fixedCompany={{ id: company.id, name: company.name, business_id: company.business_id }}
      basePath={`/taloyhtiot/${company.id}/kulutus`}
      header={<CompanyHeader company={company} active="kulutus" />}
    />
  );
}
