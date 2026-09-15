import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { listBuildings } from "@/lib/registry/queries";
import { ShareGroupForm } from "../ShareGroupForm";

export const metadata = { title: "Uusi huoneisto" };

export default async function NewShareGroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const buildings = await ctx.run((tx) => listBuildings(tx, id));
  const { virhe } = await searchParams;
  return (
    <>
      <CompanyHeader company={company} active="huoneistot" sub="Uusi huoneisto" />
      <h2 className="mb-4 text-xl">Uusi huoneisto</h2>
      <FormError message={virhe} />
      <ShareGroupForm companyId={id} buildings={buildings} />
    </>
  );
}
