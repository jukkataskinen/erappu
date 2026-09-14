import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchQueued } from "@/lib/messaging";
import { isCronAuthorized } from "@/lib/announcements/cron";

export const dynamic = "force-dynamic";

const BATCH = 50;
const MAX_ROUNDS = 20;

/**
 * Viestijonon ajastettu purku (esim. Vercel Cron 5 min välein). Vastaus ei
 * sisällä vastaanottajia eikä virheiden sisältöä, vain määrät.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), { CRON_SECRET: process.env.CRON_SECRET, NODE_ENV: process.env.NODE_ENV })) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  let sent = 0;
  let failed = 0;
  let rounds = 0;
  // Jokainen erä omassa transaktiossaan, jottei yksi pitkä lukitus estä uusia viestejä.
  while (rounds < MAX_ROUNDS) {
    rounds++;
    const r = await db.asService((tx) => dispatchQueued(tx, BATCH));
    sent += r.sent;
    failed += r.failed;
    if (r.sent + r.failed < BATCH) break;
  }
  return NextResponse.json({ sent, failed, rounds }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
