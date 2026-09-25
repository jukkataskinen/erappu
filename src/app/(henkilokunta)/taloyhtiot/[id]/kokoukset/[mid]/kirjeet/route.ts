import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { loadMeetingLetterPreview } from "@/lib/letters/meeting";
import { letterPreviewResponse } from "@/lib/letters/preview-response";

/** Paperikutsujen vedos tai koetuloste (ks. `letterPreviewResponse`). */
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const ctx = await requireStaff();
  const { id, mid } = await params;
  const kind = new URL(request.url).searchParams.get("tyyppi");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(mid) || (kind !== "vedos" && kind !== "koe")) return new NextResponse("Ei löytynyt", { status: 404 });
  // Kokous luetaan käyttäjän RLS-transaktiossa; toisen yhtiön tai organisaation kokous on 404.
  const owned = await ctx.run((tx) => tx.query("select 1 from er_meetings where id = $1 and company_id = $2", [mid, id]));
  if (owned.length === 0) return new NextResponse("Ei löytynyt", { status: 404 });
  const calibration = kind === "koe";
  return letterPreviewResponse(() => loadMeetingLetterPreview(ctx.run, mid, calibration), calibration, calibration ? "koetuloste.pdf" : "kirjeiden-vedos.pdf");
}
