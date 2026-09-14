import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveProviderTask } from "@/lib/service-requests/links";
import { readStoredFile } from "@/lib/storage";

/**
 * Huoltopyynnön kuva palveluntuottajalle. Ei kirjautumista: linkki
 * ratkaistaan palvelun roolilla ja kuvan pitää kuulua juuri linkin pyyntöön
 * ja olla näkyvyydeltään palveluntuottajalle sallittu. Muuten 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await params;
  const notFound = () => new NextResponse("Ei löytynyt", { status: 404 });
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(docId)) return notFound();

  const db = await getDb();
  const doc = await db.asService(async (tx) => {
    const task = await resolveProviderTask(tx, token);
    if (!task) return null;
    const [row] = await tx.query<{ storage_path: string; mime_type: string }>(
      `select storage_path, mime_type from er_documents
        where id = $1 and subject_table = 'er_service_requests' and subject_id = $2 and organization_id = $3
          and category = 'photo' and visibility in ('reporter', 'provider')`,
      [docId, task.requestId, task.organizationId],
    );
    return row ?? null;
  });
  if (!doc || !doc.mime_type.startsWith("image/")) return notFound();

  const bytes = await readStoredFile(doc.storage_path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
