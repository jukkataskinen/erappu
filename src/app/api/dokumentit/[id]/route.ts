import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

/**
 * Dokumentin lataus. Rivi haetaan käyttäjän RLS-transaktiossa: jos käyttäjä
 * ei näe riviä (toinen organisaatio, väärä näkyvyys), vastaus on 404 eikä
 * tiedostoa lueta lainkaan. Julkisia tiedostolinkkejä ei ole.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Kirjautuminen vaaditaan", { status: 401 });

  const db = await getDb();
  const [doc] = await db.asUser(user.sub, (tx) =>
    tx.query<{ storage_path: string; mime_type: string; file_name: string }>("select storage_path, mime_type, file_name from er_documents where id = $1", [id]),
  );
  if (!doc) return new NextResponse("Ei löytynyt", { status: 404 });

  const bytes = await readStoredFile(doc.storage_path);
  const inline = new URL(request.url).searchParams.get("lataa") !== "1" && (doc.mime_type === "application/pdf" || doc.mime_type.startsWith("image/"));
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
