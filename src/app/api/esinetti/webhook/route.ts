import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEsinettiClient, parseWebhookPayload, verifyWebhookSignature } from "@/lib/esinetti";
import { processSigningEvent } from "@/lib/signing/process";

export const dynamic = "force-dynamic";

/** eSinetti lähettää enintään muutaman megan JSONia; isompi on väärinkäyttöä. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * eSinetin webhook. Julkinen osoite: ainoa suoja on HMAC-allekirjoitus
 * (`X-eSinetti-Signature`), joka tarkistetaan raa'asta rungosta ennen kuin
 * mitään jäsennetään. Virheellinen allekirjoitus → 401 ilman selitystä.
 * Käsittely on idempotentti (er_webhook_events), joten eSinetin
 * uudelleenyritykset ovat turvallisia. Ei payloadia eikä otsakkeita lokiin.
 */
export async function POST(request: Request) {
  const secret = process.env.ESINETTI_WEBHOOK_SECRET ?? "";
  if (!secret) return new NextResponse(null, { status: 503 });

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  if (!verifyWebhookSignature(secret, request.headers.get("x-esinetti-signature"), rawBody)) {
    return new NextResponse(null, { status: 401 });
  }

  const event = parseWebhookPayload(rawBody);
  if (!event) return new NextResponse(null, { status: 400 });

  try {
    const result = await processSigningEvent(await getDb(), event, rawBody, { client: getEsinettiClient() });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // 500 → eSinetti yrittää uudelleen. Lokiin vain tapahtuman tyyppi ja virheen laji.
    console.error(`[esinetti-webhook] ${event.event}: ${err instanceof Error ? err.name : "virhe"}`);
    return new NextResponse(null, { status: 500 });
  }
}
