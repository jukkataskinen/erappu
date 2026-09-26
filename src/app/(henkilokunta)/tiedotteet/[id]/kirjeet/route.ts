import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { loadAnnouncementLetterPreview } from "@/lib/letters/announcement";
import { letterPreviewResponse } from "@/lib/letters/preview-response";

/** Tiedotekirjeiden vedos tai koetuloste (ks. `letterPreviewResponse`). */
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("tyyppi");
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "vedos" && kind !== "koe")) return new NextResponse("Ei löytynyt", { status: 404 });
  const owned = await ctx.run((tx) => tx.query("select 1 from er_announcements where id = $1", [id]));
  if (owned.length === 0) return new NextResponse("Ei löytynyt", { status: 404 });
  const calibration = kind === "koe";
  return letterPreviewResponse(() => loadAnnouncementLetterPreview(ctx.run, id, calibration), calibration, calibration ? "koetuloste.pdf" : "kirjeiden-vedos.pdf");
}
