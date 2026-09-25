import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";
import { dispatchQueued, queueMessage } from "@/lib/messaging";
import type { Database } from "@/lib/db/types";

/**
 * Jonosta puretaan vain sähköpostit. Tekstiviesti, kirje ja push jäävät
 * jonoon, koska niille ei ole palvelua: lähetetyksi merkitty viesti, joka ei
 * lähtenyt, johtaisi osakasta harhaan.
 */
let db: Database;
let fx: Fixture;

beforeAll(async () => {
  db = await freshDb();
  fx = await seedTwoOrgs(db);
});
afterAll(async () => db.close());

describe("viestijono", () => {
  it("merkitsee lähetetyksi vain sähköpostin, muut kanavat jäävät jonoon", async () => {
    await db.asService(async (tx) => {
      for (const channel of ["email", "sms", "letter", "push"] as const) {
        await queueMessage(tx, { organizationId: fx.orgA, channel, recipient: channel === "email" ? "osakas@example.test" : "x", subject: `Testi ${channel}`, body: "Teksti" });
      }
    });
    const result = await db.asService((tx) => dispatchQueued(tx, 50, fx.orgA));
    expect(result).toEqual({ sent: 1, failed: 0 });
    const rows = await db.asService((tx) =>
      tx.query<{ channel: string; status: string }>("select channel, status from er_outbound_messages where organization_id = $1 order by channel", [fx.orgA]),
    );
    expect(Object.fromEntries(rows.map((r) => [r.channel, r.status]))).toEqual({ email: "sent", letter: "queued", push: "queued", sms: "queued" });

    // Toinen purku ei koske jonoon jääneisiin.
    expect(await db.asService((tx) => dispatchQueued(tx, 50, fx.orgA))).toEqual({ sent: 0, failed: 0 });
  });
});
