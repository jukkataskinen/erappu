import { StaffShell } from "@/components/StaffShell";
import { requireStaff } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  return <StaffShell ctx={ctx}>{children}</StaffShell>;
}
