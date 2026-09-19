import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { isoDateHelsinki } from "@/lib/format";
import { loadGuideCompany, renderGuidePdf } from "@/lib/maintenance/renovation-guide-document";

/** Muutostyöohjeen esikatselu tallennetuista asetuksista. Mitään ei tallenneta. */
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  const company = await ctx.run((tx) => loadGuideCompany(tx, id));
  if (!company) return new NextResponse("Ei löytynyt", { status: 404 });
  const pdf = await renderGuidePdf(company, isoDateHelsinki());
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
