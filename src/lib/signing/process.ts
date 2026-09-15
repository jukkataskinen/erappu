import "server-only";
import type { Database, Sql } from "@/lib/db";
import { sha256Hex } from "@/lib/security/crypto";
import { deleteStoredFile, storeFile, type StoredFile } from "@/lib/storage";
import { parseExternalRef, type EsinettiClient, type WebhookEvent } from "@/lib/esinetti";
import { mergeSigners, type RoundRow, type SubjectHandler } from "./rounds";
import { contractSigningHandler } from "@/lib/contract-templates/signing";
import { meetingSigningHandler } from "@/lib/meetings/signing-webhook";

/**
 * eSinetin allekirjoitustapahtumien käsittely ja reititys kohteen mukaan.
 *
 * Kierroksen `subject_table` ratkaisee käsittelijän, ja `externalRef`in
 * (`erappu:<kind>:<uuid>`) on vastattava kierrosriviä. Idempotenssi on tässä
 * yhdessä paikassa kaikille kohteille: tapahtuman id tauluun
 * `er_webhook_events` (uniikki) samassa transaktiossa kuin tilamuutos, eikä
 * valmista kierrosta käsitellä uudelleen.
 */

export interface SigningDeps {
  client: EsinettiClient;
  store?: (opts: Parameters<typeof storeFile>[0]) => Promise<StoredFile>;
  remove?: (storagePath: string) => Promise<void>;
}

export type ProcessResult = "processed" | "duplicate" | "ignored";
export type { RoundRow, SubjectHandler } from "./rounds";

const HANDLERS: SubjectHandler[] = [meetingSigningHandler, contractSigningHandler];

export function handlerForSubject(subjectTable: string): SubjectHandler | null {
  return HANDLERS.find((h) => h.subjectTable === subjectTable) ?? null;
}

const STATUS_BY_EVENT: Record<string, string> = {
  "round.sent": "sent",
  "signer.opened": "sent",
  "signer.identified": "sent",
  "signer.signed": "partially_signed",
  "signer.declined": "partially_signed",
  "round.cancelled": "cancelled",
  "round.expired": "expired",
  "round.completed": "completed",
};

async function recordEvent(tx: Sql, event: WebhookEvent, payloadHash: string, organizationId: string | null): Promise<boolean> {
  const rows = await tx.query(
    `insert into er_webhook_events (organization_id, provider, event_id, event_name, payload_hash)
     values ($1, 'esinetti', $2, $3, $4) on conflict (event_id) do nothing returning id`,
    [organizationId, event.id, event.event, payloadHash],
  );
  return rows.length > 0;
}

/**
 * Käsittelee allekirjoituksen tarkistetun webhook-tapahtuman. Ajetaan
 * palvelun roolilla: kutsujaa ei ole kirjautunut, ja oikeus perustuu
 * allekirjoitukseen, joka on tarkistettu ennen tätä.
 */
export async function processSigningEvent(db: Database, event: WebhookEvent, rawBody: string, deps: SigningDeps): Promise<ProcessResult> {
  const payloadHash = sha256Hex(rawBody);
  const store = deps.store ?? storeFile;
  const remove = deps.remove ?? deleteStoredFile;

  const lookup = await db.asService(async (tx) => {
    const [seen] = await tx.query("select 1 from er_webhook_events where event_id = $1", [event.id]);
    if (seen) return { duplicate: true as const };
    const [round] = await tx.query<RoundRow>(
      "select id, organization_id, company_id, subject_table, subject_id, status, signers from er_signing_rounds where esinetti_round_id = $1",
      [event.roundId],
    );
    return { duplicate: false as const, round: round ?? null };
  });
  if (lookup.duplicate) return "duplicate";

  const round = lookup.round;
  const ref = parseExternalRef(event.externalRef);
  const handler = round ? handlerForSubject(round.subject_table) : null;
  const matches = round && handler && ref && ref.kind === handler.refKind && ref.id === round.subject_id;
  if (!round || !handler || !matches || !STATUS_BY_EVENT[event.event]) {
    // Tuntematon kierros tai tapahtuma kirjataan, jotta eSinetin toisto ei
    // käsittele sitä uudelleen, mutta mitään ei muuteta.
    const inserted = await db.asService((tx) => recordEvent(tx, event, payloadHash, round?.organization_id ?? null));
    return inserted ? "ignored" : "duplicate";
  }

  if (event.event !== "round.completed" || round.status === "completed") {
    return db.asService(async (tx) => {
      if (!(await recordEvent(tx, event, payloadHash, round.organization_id))) return "duplicate";
      if (round.status === "completed") return "ignored";
      const next = event.event.startsWith("signer.")
        ? event.signers.some((s) => s.status === "signed") ? "partially_signed" : "sent"
        : STATUS_BY_EVENT[event.event];
      await tx.query(
        "update er_signing_rounds set status = $2, signers = $3, last_event = $4 where id = $1 and status <> 'completed'",
        [round.id, next, JSON.stringify(mergeSigners(round.signers, event)), event.event],
      );
      if (handler.onStatus) await handler.onStatus(tx, round, event);
      return "processed";
    });
  }

  // round.completed: sinetöity asiakirja talteen ennen tilamuutosta.
  const documentId = event.documents[0]?.id ?? (await deps.client.getRound(event.roundId)).documents[0]?.id;
  if (!documentId) throw new Error("Kierroksella ei ole asiakirjaa.");
  const bytes = Buffer.from(await deps.client.downloadRoundDocument(event.roundId, documentId));
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("Sinetöity asiakirja ei ole PDF.");

  const file = await handler.sealedFile(db, round);
  const stored = await store({
    organizationId: round.organization_id,
    companyId: file.companyId,
    fileName: file.fileName,
    mimeType: "application/pdf",
    bytes,
  });

  const result = await db.asService(async (tx) => {
    if (!(await recordEvent(tx, event, payloadHash, round.organization_id))) return "duplicate" as const;
    await handler.onCompleted(tx, round, event, stored);
    return "processed" as const;
  });
  if (result === "duplicate") await remove(stored.storagePath);
  return result;
}
