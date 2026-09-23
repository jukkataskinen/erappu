import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { buildCompanyArchive } from "@/lib/export/company-archive";

/**
 * Yhtiön aineiston luovutus zip-tiedostona (palvelusopimus 10.3). Vain
 * isännöinnin roolit: aineisto sisältää kaikki yhtiön rekisteritiedot ja
 * asiakirjat, joten kirjanpitäjälle sitä ei anneta. Jokainen lataus kirjataan
 * tapahtumalokiin.
 */
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  if (!ctx.can("owner", "manager", "assistant")) return new NextResponse("Ei oikeutta", { status: 403 });

  const archive = await ctx.run((tx) => buildCompanyArchive(tx, id, ctx.user.id));
  if (!archive) return new NextResponse("Ei löytynyt", { status: 404 });

  return new NextResponse(new Uint8Array(archive.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
