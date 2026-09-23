import { openLocalDb } from "../scripts/lib/local-db.mts";
const db = await openLocalDb();
await db.asService(async (tx) => {
  console.log(await tx.query("select kind, starts_at::text, status, notice_sent_at::text from er_meetings where company_id = '08a1270b-5576-4271-846c-813efd3bbd60'"));
});
await db.close();
