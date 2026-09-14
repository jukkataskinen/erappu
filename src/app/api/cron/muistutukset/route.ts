import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { queueContractReminders } from "@/lib/contracts/reminders";
import { isoDateHelsinki } from "@/lib/format";
import { queueTaskReminders } from "@/lib/tasks/reminders";

/**
 * Päivittäinen muistutusajo (Vercel Cron tai muu ajastin): vuosikellon
 * erääntyvät ja myöhässä olevat tehtävät sekä sopimusten irtisanomis-
 * muistutukset lähtevien viestien jonoon. Lähetys tehdään viestijonon
 * omassa ajossa.
 *
 * Suojaus: Authorization: Bearer CRON_SECRET. Kehityksessä ilman
 * CRON_SECRETia sallitaan, tuotannossa ei koskaan. Ajo on idempotentti,
 * joten uusintayritys samana päivänä ei lähetä samaa muistutusta.
 */
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const today = isoDateHelsinki();
  try {
    const db = await getDb();
    const tasks = await db.asService((tx) => queueTaskReminders(tx, today));
    const contracts = await db.asService((tx) => queueContractReminders(tx, today));
    return NextResponse.json({ ok: true, date: today, tasks, contracts });
  } catch (err) {
    // Ei rakennetta vastaukseen; tarkempi virhe palvelimen lokiin.
    console.error("[cron:muistutukset]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
