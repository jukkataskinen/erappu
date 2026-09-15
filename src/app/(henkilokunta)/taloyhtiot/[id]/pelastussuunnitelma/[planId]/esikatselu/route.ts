import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { previewPlanPdf } from "@/lib/rescue-plans/document";

/**
 * Pelastussuunnitelman esikatselu tallennetusta sisällöstä. Rivi luetaan
 * käyttäjän RLS-transaktiossa, joten toisen organisaation suunnitelma → 404.
 * Mitään ei tallenneta; valmis versio avataan dokumenttina (/api/dokumentit).
 */
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; planId: string }> }) {
  const ctx = await requireStaff();
  const { id, planId } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(planId)) return new NextResponse("Ei löytynyt", { status: 404 });
  const pdf = await previewPlanPdf(ctx.run, planId, id);
  if (!pdf) return new NextResponse("Ei löytynyt", { status: 404 });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
