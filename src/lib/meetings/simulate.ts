import "server-only";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db";
import { buildExternalRef, canSimulateSigning, EsinettiError, getEsinettiClient, type EsinettiClient, type Round, type WebhookEvent } from "@/lib/esinetti";
import { completeMockRound } from "@/lib/esinetti/mock";
import { readStoredFile } from "@/lib/storage";
import { processSigningEvent } from "@/lib/signing/process";
import { SUBJECT_REF_KIND } from "@/lib/signing/rounds";

/**
 * Kehityksen "Simuloi allekirjoitus": allekirjoittaa mock-kierroksen kaikkien
 * puolesta ja ajaa saman käsittelyn kuin oikea webhook. Estetty, kun
 * ESINETTI_MODE=http tai NODE_ENV=production. Toimii kaikille kierroksen
 * kohteille (pöytäkirja, sopimus): externalRef johdetaan kierroksen kohteesta.
 *
 * Mockin tila on muistissa. Jos kehityspalvelin on käynnistetty uudelleen
 * kierroksen luonnin jälkeen, "sinetöidyksi" otetaan alkuperäinen PDF, jotta
 * polun voi silti kokeilla loppuun.
 */
export async function simulateSigning(db: Database, signingRoundId: string, userSub: string): Promise<void> {
  if (!canSimulateSigning()) throw new Error("Simulointi ei ole käytössä.");

  const [row] = await db.asUser(userSub, (tx) =>
    tx.query<{ esinetti_round_id: string; subject_table: string; subject_id: string; storage_path: string | null; signers: { name: string; email: string; role: string }[] }>(
      `select r.esinetti_round_id, r.subject_table, r.subject_id, d.storage_path, r.signers
         from er_signing_rounds r left join er_documents d on d.id = r.original_document_id
        where r.id = $1 and r.status in ('draft', 'sent', 'partially_signed')`,
      [signingRoundId],
    ),
  );
  if (!row) throw new Error("Kierrosta ei löytynyt.");
  const refKind = SUBJECT_REF_KIND[row.subject_table];
  if (!refKind) throw new Error("Kierroksen kohdetta ei tunneta.");

  let round: Round;
  let client: EsinettiClient = getEsinettiClient();
  try {
    round = completeMockRound(row.esinetti_round_id);
  } catch (err) {
    if (!(err instanceof EsinettiError && err.code === "not_found") || !row.storage_path) throw err;
    const original = await readStoredFile(row.storage_path);
    const now = new Date().toISOString();
    const docId = randomUUID();
    round = {
      id: row.esinetti_round_id, title: "", status: "completed", sequential: false, externalRef: buildExternalRef(refKind, row.subject_id),
      expiresAt: null, completedAt: now, createdAt: now,
      documents: [{ id: docId, name: "asiakirja.pdf", position: 0, pageCount: null, sizeBytes: original.length, originalSha256: null, sealedSha256: null }],
      signers: row.signers.map((s, i) => ({
        id: randomUUID(), name: s.name, email: s.email, roleLabel: s.role, authLevel: "strong", position: i, status: "signed",
        openedAt: now, identifiedAt: now, signedAt: now, declinedAt: null,
      })),
    };
    // Käsittely tarvitsee vain nämä kaksi kutsua.
    const fallback = round;
    client = { downloadRoundDocument: async () => new Uint8Array(original), getRound: async () => fallback } as unknown as EsinettiClient;
  }

  const event: WebhookEvent = {
    id: `sim-${randomUUID()}`,
    event: "round.completed",
    createdAt: new Date().toISOString(),
    roundId: round.id,
    externalRef: round.externalRef,
    status: round.status,
    signers: round.signers.map((s) => ({
      id: s.id, name: s.name, email: s.email, roleLabel: s.roleLabel, status: s.status,
      openedAt: s.openedAt, identifiedAt: s.identifiedAt, signedAt: s.signedAt, declinedAt: s.declinedAt,
    })),
    documents: round.documents.map((d) => ({ id: d.id, name: d.name, sealedSha256: d.sealedSha256, downloadUrl: null })),
  };
  await processSigningEvent(db, event, JSON.stringify({ simulated: event.id }), { client });
}
