import { FormError } from "@/components/FormError";
import { Notice, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listContractDocuments } from "@/lib/contracts/queries";
import { listCompanies } from "@/lib/registry/queries";
import { ContractForm } from "../ContractForm";

export const metadata = { title: "Uusi sopimus" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ virhe?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, yhtio } = await searchParams;
  const [companies, documents] = await ctx.run((tx) => Promise.all([listCompanies(tx, ctx.org.organizationId), listContractDocuments(tx, ctx.org.organizationId)]));
  const canWrite = ctx.can("owner", "manager", "assistant");
  return (
    <>
      <PageHeader title="Uusi sopimus" back={{ href: "/sopimukset", label: "Sopimukset" }} />
      <FormError message={virhe} />
      {!canWrite ? (
        <div className="mb-5">
          <Notice tone="warn" title="Roolillasi voit vain katsella sopimuksia" />
        </div>
      ) : null}
      <div className="max-w-3xl">
        <ContractForm companies={companies} documents={documents} defaultCompanyId={companies.some((c) => c.id === yhtio) ? yhtio : undefined} readOnly={!canWrite} />
      </div>
    </>
  );
}
