import type { Database, Sql } from "@/lib/db";
import type { ExternalRefKind, WebhookEvent } from "@/lib/esinetti";
import type { StoredFile } from "@/lib/storage";

/**
 * Allekirjoituskierrosten yhteiset tyypit ja apurit. Erillään reitittimestä
 * (`process.ts`), jotta käsittelijät voivat tuoda nämä ilman kehäriippuvuutta.
 */

export interface RoundRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  subject_table: string;
  subject_id: string;
  status: string;
  signers: { name: string; email: string; role: string; status?: string; signedAt?: string | null }[];
}

export interface SubjectHandler {
  subjectTable: string;
  refKind: ExternalRefKind;
  /** Muu kuin valmistumistapahtuma; kierrosrivi on jo päivitetty samassa transaktiossa. */
  onStatus?(tx: Sql, round: RoundRow, event: WebhookEvent): Promise<void>;
  /** Sinetöidyn tiedoston yhtiö ja nimi. */
  sealedFile(db: Database, round: RoundRow): Promise<{ companyId: string | null; fileName: string }>;
  /** Tallentaa dokumenttirivin, merkitsee kierroksen ja kohteen valmiiksi. */
  onCompleted(tx: Sql, round: RoundRow, event: WebhookEvent, stored: StoredFile): Promise<void>;
}

/** Kierroksen kohdetaulu → externalRefin laji. */
export const SUBJECT_REF_KIND: Record<string, ExternalRefKind> = {
  er_meetings: "meeting",
  er_contract_batch_items: "contract",
};

export function mergeSigners(stored: RoundRow["signers"], event: WebhookEvent) {
  return (stored ?? []).map((s) => {
    const remote = event.signers.find((r) => r.email.toLowerCase() === s.email.toLowerCase());
    return remote ? { ...s, status: remote.status, signedAt: remote.signedAt } : s;
  });
}

export async function markRoundCompleted(tx: Sql, round: RoundRow, event: WebhookEvent, sealedDocumentId: string): Promise<void> {
  await tx.query(
    `update er_signing_rounds set status = 'completed', sealed_document_id = $2, completed_at = now(), last_event = $3, signers = $4 where id = $1`,
    [round.id, sealedDocumentId, event.event, JSON.stringify(mergeSigners(round.signers, event))],
  );
}
