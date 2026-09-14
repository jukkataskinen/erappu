import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getHtjClient, HtjError } from "@/lib/htj";
import { runChangeSync } from "@/lib/htj/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * HTJ:n muutostietojen yöajo (Vercel Cron). Hakee muutokset edellisestä
 * onnistuneesta ajosta alkaen ja tekee muuttuneille yhtiöille vertailun;
 * erot jäävät isännöitsijän hyväksyttäviksi.
 *
 * Suojaus: `Authorization: Bearer <CRON_SECRET>` (Vercel lähettää sen
 * automaattisesti). Ilman asetettua salaisuutta reitti on suljettu.
 * Vastaus sisältää vain lukumäärät.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const [db, client] = await Promise.all([getDb(), getHtjClient()]);
    const result = await runChangeSync(db, client);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof HtjError ? err.code : "internal";
    console.error(`[cron:htj] epäonnistui (${code})`);
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
