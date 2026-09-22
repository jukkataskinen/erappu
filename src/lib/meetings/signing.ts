import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildExternalRef, createRoundOnce, type EsinettiClient, type Round } from "@/lib/esinetti";
import { ensureEsinettiCompany } from "@/lib/signing/company";
import { generateMeetingDocument } from "./documents";
import { MeetingAttachmentPdfError } from "./attachment-pdf";
import { MEETING_KIND } from "./labels";
import { loadMinutesSignerPlan, type SignerInput } from "./minutes-signers";

/**
 * Pöytäkirjan allekirjoitus eSinetissä.
 *
 * Lähetys: pöytäkirja renderöidään → kierros eSinettiin (puheenjohtaja ja
 * yhtiöjärjestyksen mukaiset allekirjoittajat, vahva tunnistus) → `er_signing_rounds`.
 *
 * Paluu: webhook (`processSigningEvent`) → sinetöity PDF talteen →
 * `er_documents` (sealed) → kokous `minutes_signed`. Käsittely on
 * idempotentti kahdella tasolla: tapahtuman id tauluun `er_webhook_events`
 * (uniikki) ja valmista kierrosta ei käsitellä uudelleen.
 */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export type { SignerInput } from "./minutes-signers";

export class SigningError extends Error {}

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
  // Hallituksen kokouksessa allekirjoittajat yhtiöjärjestyksen säännön mukaan (0113).
  const plan = await run((tx) => loadMinutesSignerPlan(tx, meetingId));
  if (!plan) throw new SigningError("Kokousta ei löytynyt.");
  if (plan.problems.length) throw new SigningError(plan.problems[0]);
  const signers = plan.signers;

  const generated = await generateMeetingDocument(run, userId, meetingId, "minutes").catch((err) => {
    if (err instanceof MeetingAttachmentPdfError) throw new SigningError(err.message);
    throw err;
  });
  if (!generated) throw new SigningError("Pöytäkirjaa ei voitu muodostaa.");

  const date = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki" }).format(new Date(meeting.starts_at));
  const esinettiCompanyId = await ensureEsinettiCompany(run, client, meeting.company_id);
  const round = await createRoundOnce(client, {
    companyId: esinettiCompanyId,
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
// Webhook: käsittely ja reititys kohteen mukaan on yhteinen kokouksille ja
// sopimuksille (`src/lib/signing/process.ts`); pöytäkirjan valmistuminen
// `signing-webhook.ts`. Vienti säilytetään, jotta kutsujat eivät muutu.

export { processSigningEvent, type ProcessResult, type SigningDeps } from "@/lib/signing/process";
