import "server-only";
import type { Database, Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/security/crypto";
import { deleteStoredFile, storeFile, type StoredFile } from "@/lib/storage";
import { buildExternalRef, parseExternalRef, type EsinettiClient, type Round, type WebhookEvent } from "@/lib/esinetti";
import { generateMeetingDocument, meetingDocumentVisibility } from "./documents";
import { MEETING_KIND } from "./labels";

/**
 * Pöytäkirjan allekirjoitus eSinetissä.
 *
 * Lähetys: pöytäkirja renderöidään → kierros eSinettiin (puheenjohtaja ja
 * pöytäkirjantarkastajat, vahva tunnistus) → `er_signing_rounds`.
 *
 * Paluu: webhook (`processSigningEvent`) → sinetöity PDF talteen →
 * `er_documents` (sealed) → kokous `minutes_signed`. Käsittely on
 * idempotentti kahdella tasolla: tapahtuman id tauluun `er_webhook_events`
 * (uniikki) ja valmista kierrosta ei käsitellä uudelleen.
 */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface SignerInput {
  name: string;
  email: string;
  role: string;
}

export class SigningError extends Error {}

export function minutesSigners(meeting: { chair_name: string | null; chair_email: string | null; minutes_checkers: { name: string; email: string }[] }): SignerInput[] {
  const signers: SignerInput[] = [];
  if (meeting.chair_name && meeting.chair_email) signers.push({ name: meeting.chair_name, email: meeting.chair_email, role: "Puheenjohtaja" });
  for (const c of meeting.minutes_checkers ?? []) {
    if (c?.name && c?.email) signers.push({ name: c.name, email: c.email, role: "Pöytäkirjantarkastaja" });
  }
  return signers;
}

export async function startMinutesSigning(run: Runner, userId: string, meetingId: string, client: EsinettiClient): Promise<string> {
  const meeting = await run(async (tx) => {
    const [m] = await tx.query<{
      id: string; organization_id: string; company_id: string; kind: string; status: string; starts_at: string; company_name: string;
      chair_name: string | null; chair_email: string | null; minutes_checkers: { name: string; email: string }[];
    }>(
      `select m.id, m.organization_id, m.company_id, m.kind, m.status, m.starts_at, c.name as company_name, m.chair_name, m.chair_email, m.minutes_checkers
         from er_meetings m join er_housing_companies c on c.id = m.company_id where m.id = $1`,
      [meetingId],
    );
    if (!m) return null;
    const [active] = await tx.query("select id from er_signing_rounds where subject_table = 'er_meetings' and subject_id = $1 and status in ('draft','sent','partially_signed')", [meetingId]);
    return { ...m, hasActive: !!active };
  });
  if (!meeting) throw new SigningError("Kokousta ei löytynyt.");
  if (meeting.status !== "held") throw new SigningError("Merkitse kokous pidetyksi ennen pöytäkirjan lähettämistä allekirjoitettavaksi.");
  if (meeting.hasActive) throw new SigningError("Pöytäkirja on jo allekirjoituskierroksella.");
  const signers = minutesSigners(meeting);
  if (!signers.some((s) => s.role === "Puheenjohtaja")) throw new SigningError("Anna puheenjohtajan nimi ja sähköposti.");
  if (signers.length < 2) throw new SigningError("Anna vähintään yhden pöytäkirjantarkastajan nimi ja sähköposti.");

  const generated = await generateMeetingDocument(run, userId, meetingId, "minutes");
  if (!generated) throw new SigningError("Pöytäkirjaa ei voitu muodostaa.");

  const date = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at));
  const round = await client.createRound({
    title: `${meeting.company_name}: ${MEETING_KIND[meeting.kind as keyof typeof MEETING_KIND].toLowerCase()} ${date}, pöytäkirja`,
    documents: [{ name: `poytakirja-${new Date(meeting.starts_at).toISOString().slice(0, 10)}.pdf`, pdfBytes: generated.bytes }],
    signers: signers.map((s) => ({ name: s.name, email: s.email, roleLabel: s.role, authLevel: "strong" })),
    externalRef: buildExternalRef("meeting", meetingId),
    expiresInDays: 30,
    send: true,
  });

  try {
    return await run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into er_signing_rounds (organization_id, company_id, subject_table, subject_id, esinetti_round_id, status, signers, original_document_id, last_event, created_by)
         values ($1,$2,'er_meetings',$3,$4,$5,$6,$7,'created',$8) returning id`,
        [meeting.organization_id, meeting.company_id, meetingId, round.id, round.status, JSON.stringify(signersState(signers, round)), generated.documentId, userId],
      );
      await audit(tx, { organizationId: meeting.organization_id, userId, action: "send_for_signing", entity: "meeting", entityId: meetingId, details: { roundId: row.id } });
      return row.id;
    });
  } catch (err) {
    // Kierros jäisi eSinettiin ilman vastinetta: perutaan, jotta kukaan ei allekirjoita turhaan.
    await client.cancelRound(round.id).catch(() => undefined);
    throw err;
  }
}

function signersState(signers: SignerInput[], round: Pick<Round, "signers">) {
  return signers.map((s) => {
    const remote = round.signers.find((r) => r.email.toLowerCase() === s.email.toLowerCase());
    return { name: s.name, email: s.email, role: s.role, status: remote?.status ?? "pending", signedAt: remote?.signedAt ?? null };
  });
}

// ---------------------------------------------------------------------------
// Webhook

export interface SigningDeps {
  client: EsinettiClient;
  store?: (opts: Parameters<typeof storeFile>[0]) => Promise<StoredFile>;
  remove?: (storagePath: string) => Promise<void>;
}

export type ProcessResult = "processed" | "duplicate" | "ignored";

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

interface RoundRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  subject_table: string;
  subject_id: string;
  status: string;
  signers: { name: string; email: string; role: string; status?: string; signedAt?: string | null }[];
}

async function recordEvent(tx: Sql, event: WebhookEvent, payloadHash: string, organizationId: string | null): Promise<boolean> {
  const rows = await tx.query(
    `insert into er_webhook_events (organization_id, provider, event_id, event_name, payload_hash)
     values ($1, 'esinetti', $2, $3, $4) on conflict (event_id) do nothing returning id`,
    [organizationId, event.id, event.event, payloadHash],
  );
  return rows.length > 0;
}

function mergeSigners(stored: RoundRow["signers"], event: WebhookEvent) {
  return (stored ?? []).map((s) => {
    const remote = event.signers.find((r) => r.email.toLowerCase() === s.email.toLowerCase());
    return remote ? { ...s, status: remote.status, signedAt: remote.signedAt } : s;
  });
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
  const matches = round && ref && ref.kind === "meeting" && round.subject_table === "er_meetings" && ref.id === round.subject_id;
  if (!round || !matches || !STATUS_BY_EVENT[event.event]) {
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
      return "processed";
    });
  }

  // round.completed: sinetöity asiakirja talteen ennen tilamuutosta.
  const documentId = event.documents[0]?.id ?? (await deps.client.getRound(event.roundId)).documents[0]?.id;
  if (!documentId) throw new Error("Kierroksella ei ole asiakirjaa.");
  const bytes = Buffer.from(await deps.client.downloadRoundDocument(event.roundId, documentId));
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("Sinetöity asiakirja ei ole PDF.");

  const meta = await db.asService((tx) =>
    tx.query<{ kind: string; starts_at: string; company_id: string }>("select kind, starts_at, company_id from er_meetings where id = $1", [round.subject_id]),
  );
  const meeting = meta[0];
  if (!meeting) throw new Error("Kokousta ei löytynyt.");
  const date = new Date(meeting.starts_at).toISOString().slice(0, 10);
  const stored = await store({
    organizationId: round.organization_id,
    companyId: meeting.company_id,
    fileName: `poytakirja-allekirjoitettu-${date}.pdf`,
    mimeType: "application/pdf",
    bytes,
  });

  const result = await db.asService(async (tx) => {
    if (!(await recordEvent(tx, event, payloadHash, round.organization_id))) return "duplicate" as const;
    const [doc] = await tx.query<{ id: string }>(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                 visibility, year, subject_table, subject_id, sealed)
       values ($1,$2,'minutes',$3,$4,$5,$6,$7,$8,$9,$10,'er_meetings',$11,true) returning id`,
      [round.organization_id, meeting.company_id,
        `Pöytäkirja (allekirjoitettu): ${MEETING_KIND[meeting.kind as keyof typeof MEETING_KIND].toLowerCase()} ${new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at))}`,
        stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256,
        meetingDocumentVisibility(meeting.kind, "minutes"), Number(date.slice(0, 4)), round.subject_id],
    );
    await tx.query(
      `update er_signing_rounds set status = 'completed', sealed_document_id = $2, completed_at = now(), last_event = $3, signers = $4 where id = $1`,
      [round.id, doc.id, event.event, JSON.stringify(mergeSigners(round.signers, event))],
    );
    await tx.query("update er_meetings set status = 'minutes_signed' where id = $1 and status <> 'cancelled'", [round.subject_id]);
    await audit(tx, { organizationId: round.organization_id, userId: null, action: "minutes_signed", entity: "meeting", entityId: round.subject_id, details: { documentId: doc.id } });
    return "processed" as const;
  });
  if (result === "duplicate") await remove(stored.storagePath);
  return result;
}
