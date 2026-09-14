import { PortalShell } from "@/components/PortalShell";
import { requirePortal } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortal();
  return <PortalShell staffLink={ctx.user.memberships.length > 0}>{children}</PortalShell>;
}
