import { NextResponse } from "next/server";
import { buildLetterBatch, LetterPdfError } from "./pdf";
import { LetterError } from "./jobs";

/**
 * Kirjeiden esikatselu PDF:nä: vedos (kaikki lähtevät kirjeet) tai
 * koetuloste (kuvitteellinen vastaanottaja ja Postitan alueet piirrettyinä).
 * Mitään ei tallenneta eikä lähetetä. Vedoksessa on nimiä ja osoitteita,
 * joten vastaus on yksityinen eikä välimuistiin.
 */
export async function letterPreviewResponse(load: () => Promise<Parameters<typeof buildLetterBatch>[0]>, calibration: boolean, fileName: string) {
  try {
    const input = await load();
    const { pdf } = await buildLetterBatch({ ...input, calibration });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof LetterError || err instanceof LetterPdfError) {
      return new NextResponse(err.message, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw err;
  }
}
