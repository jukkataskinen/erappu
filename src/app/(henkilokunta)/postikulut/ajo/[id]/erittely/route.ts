import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { billingRunCsv, getBillingRun } from "@/lib/letters/billing";

/**
 * Laskutusajon erittely CSV:nä laskujen tekemiseen Fennoaan käsin, kunnes
 * vienti Fennoan tuotantoon on otettu käyttöön. Ajo luetaan käyttäjän
 * RLS-transaktiossa: toisen organisaation ajo on 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!ctx.can("owner", "manager", "accountant") || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  const data = await ctx.run((tx) => getBillingRun(tx, id));
  if (!data) return new NextResponse("Ei löytynyt", { status: 404 });
  return new NextResponse(billingRunCsv(data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="postikulut-${data.run.period_start}-${data.run.period_end}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
