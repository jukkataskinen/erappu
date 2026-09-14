import type { PortalContext, StaffContext } from "@/lib/auth/current-user";

/**
 * Tiedotteet ja dokumentit (moduuli M4): työpöydän, taloyhtiön yleissivun ja portaalin etusivun
 * nostot. Moduuli täyttää nämä; kehys kutsuu niitä valmiiksi.
 */
export async function StaffDashboardWidget({ ctx }: { ctx: StaffContext }) {
  void ctx;
  return null;
}

export async function CompanyOverviewWidget({ ctx, companyId }: { ctx: StaffContext; companyId: string }) {
  void ctx;
  void companyId;
  return null;
}

export async function PortalHomeWidget({ ctx }: { ctx: PortalContext }) {
  void ctx;
  return null;
}