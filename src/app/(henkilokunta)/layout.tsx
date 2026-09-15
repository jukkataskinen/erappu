import { StaffShell } from "@/components/StaffShell";
import { requireStaff } from "@/lib/auth/current-user";
import { listCompanyNames } from "@/lib/registry/queries";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  // Sivupalkki näyttää valitun yhtiön nimen; nimet haetaan kerran kehykselle.
  const companies = await ctx.run((tx) => listCompanyNames(tx, ctx.org.organizationId));
  return (
    <StaffShell ctx={ctx} companies={companies}>
      {children}
    </StaffShell>
  );
}
