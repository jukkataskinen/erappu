import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { requireStaff } from "@/lib/auth/current-user";
import { CertificatesView } from "../../../todistukset/CertificatesView";

export const metadata = { title: "Isännöitsijäntodistukset" };

export default async function CompanyCertificatesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  return (
    <CertificatesView
      ctx={ctx}
      virhe={virhe}
      fixedCompanyId={company.id}
      basePath={`/taloyhtiot/${company.id}/todistukset`}
      header={<CompanyHeader company={company} active="todistukset" />}
    />
  );
}
