import "server-only";
import type { Sql } from "@/lib/db";

/**
 * Lähtevät viestit. Kaikki ilmoitukset kirjataan ensin tauluun
 * `er_outbound_messages` samassa transaktiossa kuin niihin liittyvä muutos,
 * ja lähetys tehdään sen jälkeen (`dispatchQueued`). Näin tilamuutos ja
 * ilmoitus eivät voi erota: jos lähetys kaatuu, rivi jää jonoon.
 *
 * EMAIL_MODE=console tulostaa viestin lokiin (vain otsikko ja vastaanottajan
 * verkkotunnus, ei sisältöä) ja merkitsee sen lähetetyksi.
 *
 * Jonosta puretaan vain sähköpostit. Tekstiviestille ja pushille ei ole vielä
 * palvelua (BLOCKERS 7), joten ne jäävät jonoon eivätkä saa tilaa `sent`:
 * lähetetyksi merkitty viesti, joka ei lähtenyt, on pahempi kuin jonoon jäänyt.
 * Kirjeet eivät kulje tämän jonon kautta, vaan Postitan töinä (`src/lib/letters`).
 */
export const DISPATCHED_CHANNELS = ["email"] as const;

export interface QueueMessage {
  organizationId: string;
  channel?: "email" | "sms" | "letter" | "push";
  recipient: string;
  partyId?: string | null;
  subject: string;
  body: string;
  subjectTable?: string;
  subjectId?: string;
}

export async function queueMessage(tx: Sql, m: QueueMessage): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into er_outbound_messages (organization_id, channel, recipient, party_id, subject, body, subject_table, subject_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [m.organizationId, m.channel ?? "email", m.recipient, m.partyId ?? null, m.subject, m.body, m.subjectTable ?? null, m.subjectId ?? null],
  );
  return row.id;
}

/**
 * Lähettää jonossa olevat viestit. Ajetaan palvelun roolilla (cron tai
 * toiminnon jälkeen). `organizationId` rajaa purun yhden organisaation
 * viesteihin, kun henkilökunta käynnistää lähetyksen käsin.
 */
export async function dispatchQueued(tx: Sql, limit = 50, organizationId?: string): Promise<{ sent: number; failed: number }> {
  const rows = await tx.query<{ id: string; channel: string; recipient: string; subject: string; body: string }>(
    `select id, channel, recipient, subject, body from er_outbound_messages
      where status = 'queued' and channel = any($3::text[]) and ($2::uuid is null or organization_id = $2::uuid)
      order by created_at limit $1 for update skip locked`,
    [limit, organizationId ?? null, [...DISPATCHED_CHANNELS]],
  );
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const providerId = await deliver(r);
      await tx.query("update er_outbound_messages set status = 'sent', sent_at = now(), provider_message_id = $2 where id = $1", [r.id, providerId]);
      sent++;
    } catch (err) {
      await tx.query("update er_outbound_messages set status = 'failed', error = $2 where id = $1", [r.id, err instanceof Error ? err.message.slice(0, 300) : "tuntematon virhe"]);
      failed++;
    }
  }
  return { sent, failed };
}

async function deliver(m: { channel: string; recipient: string; subject: string; body: string }): Promise<string | null> {
  // Varmistus: kysely ei valitse muita kanavia, mutta jos valitsisi, rivi
  // merkitään epäonnistuneeksi eikä lähetetyksi.
  if (m.channel !== "email") throw new Error(`Kanavalle ${m.channel} ei ole lähetyspalvelua.`);
  if (process.env.EMAIL_MODE !== "resend") {
    const domain = m.recipient.split("@")[1] ?? "?";
    console.info(`[sähköposti:console] → *@${domain}: ${m.subject}`);
    return null;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.recipient], subject: m.subject, text: m.body }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  const json = (await res.json()) as { id?: string };
  return json.id ?? null;
}
