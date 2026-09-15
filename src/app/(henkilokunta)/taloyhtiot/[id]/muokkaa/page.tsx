import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { listStaff } from "@/lib/registry/queries";
import { CompanyForm } from "../../CompanyForm";
import { updateCompany } from "../../actions";

export const metadata = { title: "Muokkaa taloyhtiötä" };

export default async function EditCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const staff = await ctx.run((tx) => listStaff(tx, ctx.org.organizationId));
  const { virhe } = await searchParams;
  return (
    <>
      <CompanyHeader company={company} active="perustiedot" title="Muokkaa perustietoja" />
      <FormError message={virhe} />
      <CompanyForm action={updateCompany} company={company} staff={staff} submitLabel="Tallenna muutokset" />
    </>
  );
}
