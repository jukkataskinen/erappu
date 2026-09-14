import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listCompanies, listStaff } from "@/lib/registry/queries";
import { TaskForm } from "../TaskForm";

export const metadata = { title: "Uusi tehtävä" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ virhe?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, yhtio } = await searchParams;
  const [companies, staff] = await ctx.run((tx) => Promise.all([listCompanies(tx, ctx.org.organizationId), listStaff(tx, ctx.org.organizationId)]));
  return (
    <>
      <PageHeader title="Uusi tehtävä" back={{ href: "/vuosikello", label: "Vuosikello" }} />
      <FormError message={virhe} />
      <div className="max-w-3xl">
        <TaskForm companies={companies} staff={staff} defaults={{ companyId: companies.some((c) => c.id === yhtio) ? yhtio : undefined, assigneeUserId: ctx.user.id }} />
      </div>
    </>
  );
}
