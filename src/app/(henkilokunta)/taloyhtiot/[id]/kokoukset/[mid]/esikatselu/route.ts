import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { MeetingAttachmentPdfError } from "@/lib/meetings/attachment-pdf";
import { buildMeetingPdf, type MeetingDocumentKind } from "@/lib/meetings/documents";

/**
 * Kokousasiakirjan esikatselu (Jukka 22.9.2026): PDF muodostetaan kokouksen
 * nykyisistä tiedoista, eikä mitään tallenneta. Lopulliset asiakirjat
 * tallentuvat vasta kutsun lähetyksessä (kutsu ja esityslista) ja
 * pöytäkirjan allekirjoitukseen lähetyksessä.
 */
export const maxDuration = 60;

const KINDS: MeetingDocumentKind[] = ["notice", "agenda", "shareholders", "votes", "minutes"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const ctx = await requireStaff();
  const { id, mid } = await params;
  const kind = new URL(request.url).searchParams.get("kind") as MeetingDocumentKind | null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(mid) || !kind || !KINDS.includes(kind)) return new NextResponse("Ei löytynyt", { status: 404 });
  let built;
  try {
    built = await buildMeetingPdf(ctx.run, mid, kind);
  } catch (err) {
    if (err instanceof MeetingAttachmentPdfError) return new NextResponse(err.message, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    throw err;
  }
  if (!built || built.loaded.meeting.company_id !== id) return new NextResponse("Ei löytynyt", { status: 404 });
  return new NextResponse(new Uint8Array(built.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`esikatselu-${built.fileName}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
