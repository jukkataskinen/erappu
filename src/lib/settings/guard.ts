import "server-only";
import { notFound } from "next/navigation";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";

/**
 * Asetukset kuuluvat pääkäyttäjälle ja isännöitsijälle. Muille 404, jotta
 * sivun olemassaolo ei ole tieto sinänsä (sama linjaus kuin toisen
 * organisaation id:llä).
 */
export async function requireSettingsAccess(): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) notFound();
  return ctx;
}
