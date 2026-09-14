import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listStaff } from "@/lib/registry/queries";
import { CompanyForm } from "../CompanyForm";
import { createCompany } from "../actions";

export const metadata = { title: "Uusi taloyhtiö" };

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const staff = await ctx.run((tx) => listStaff(tx, ctx.org.organizationId));
  const { virhe } = await searchParams;
  return (
    <>
      <PageHeader back={{ href: "/taloyhtiot", label: "Taloyhtiöt" }} title="Uusi taloyhtiö" subtitle="Kun HTJ-yhteys on käytössä, osakeryhmät ja osakkaat haetaan HTJ:stä." />
      <FormError message={virhe} />
      <CompanyForm action={createCompany} staff={staff} submitLabel="Tallenna taloyhtiö" />
    </>
  );
}
