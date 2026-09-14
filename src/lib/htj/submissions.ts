import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import type { HtjClient } from "./client";
import { buildPayload, loadHtj2Data, SUBMISSION_KINDS, unsubmittedRows } from "./htj2";
import { withRequestLog } from "./log";
import { HtjError, type HtjSubmissionKind } from "./types";

/**
 * HTJ2-ilmoitusjono: luonnos → hyväksyntä → lähetys (tai merkintä käsin
 * tehdyksi). Roolirajat ovat kannassa (0020): kirjanpitäjä ja assistentti
 * voivat vain luoda ja päivittää luonnoksia.
 */

export class SubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionError";
  }
}

const TABLE: Record<HtjSubmissionKind, string> = {
  charges: "er_charge_bases",
  loans: "er_loans",
  loan_shares: "er_loan_shares",
  maintenance_works: "er_maintenance_works",
  maintenance_needs: "er_maintenance_needs",
};

/** Merkitsee rivit ilmoitetuiksi. Lainaosuudet rajataan yhtiöön lainan kautta. */
async function markRowsSubmitted(tx: Sql, companyId: string, kind: HtjSubmissionKind, ids: string[], refs: Record<string, string> = {}) {
  if (ids.length === 0) return;
  if (kind === "loan_shares") {
    await tx.query(
      `update er_loan_shares s set htj_submitted_at = now() from er_loans l
        where s.id = any($1::uuid[]) and l.id = s.loan_id and l.company_id = $2`,
      [ids, companyId],
    );
    return;
  }
  const hasHtjId = kind === "loans" || kind === "maintenance_works";
  if (hasHtjId && Object.keys(refs).length > 0) {
    for (const id of ids) {
      await tx.query(`update ${TABLE[kind]} set htj_submitted_at = now(), htj_id = coalesce($3, htj_id) where id = $1 and company_id = $2`, [id, companyId, refs[id] ?? null]);
    }
    return;
  }
  await tx.query(`update ${TABLE[kind]} set htj_submitted_at = now() where id = any($1::uuid[]) and company_id = $2`, [ids, companyId]);
}

/** Luonnos ilmoittamattomista riveistä. Saman lajin avoin luonnos päivitetään. */
export async function prepareDraft(tx: Sql, opts: { companyId: string; kind: HtjSubmissionKind; userId: string; today?: string }): Promise<string> {
  const data = await loadHtj2Data(tx, opts.companyId, opts.today ?? isoDateHelsinki());
  if (!data) throw new SubmissionError("Yhtiötä ei löytynyt.");
  const payload = buildPayload(opts.kind, data);
  if (payload.items.length === 0) throw new SubmissionError("Ilmoittamattomia rivejä ei ole.");

  const [existing] = await tx.query<{ id: string }>(
    "select id from er_htj_submissions where company_id = $1 and kind = $2 and status = 'draft' order by created_at desc limit 1",
    [opts.companyId, opts.kind],
  );
  let id: string;
  if (existing) {
    const rows = await tx.query<{ id: string }>("update er_htj_submissions set payload = $2, prepared_by = $3, error = null where id = $1 returning id", [existing.id, JSON.stringify(payload), opts.userId]);
    if (rows.length === 0) throw new SubmissionError("Luonnosta ei voitu päivittää.");
    id = existing.id;
  } else {
    const [row] = await tx.query<{ id: string }>(
      "insert into er_htj_submissions (organization_id, company_id, kind, payload, prepared_by) values ($1,$2,$3,$4,$5) returning id",
      [data.company.organization_id, opts.companyId, opts.kind, JSON.stringify(payload), opts.userId],
    );
    id = row.id;
  }
  await audit(tx, { organizationId: data.company.organization_id, userId: opts.userId, action: "htj_submission_draft", entity: "htj_submission", entityId: id, details: { kind: opts.kind, items: payload.items.length } });
  return id;
}

export async function approveSubmission(tx: Sql, opts: { id: string; userId: string }): Promise<void> {
  const rows = await tx.query<{ organization_id: string }>(
    "update er_htj_submissions set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft' returning organization_id",
    [opts.id, opts.userId],
  );
  if (rows.length === 0) throw new SubmissionError("Vain luonnoksen voi hyväksyä, ja hyväksyjän on oltava isännöitsijä tai pääkäyttäjä.");
  await audit(tx, { organizationId: rows[0].organization_id, userId: opts.userId, action: "htj_submission_approve", entity: "htj_submission", entityId: opts.id });
}

export async function discardDraft(tx: Sql, opts: { id: string; userId: string }): Promise<void> {
  const rows = await tx.query<{ organization_id: string }>("delete from er_htj_submissions where id = $1 and status = 'draft' returning organization_id", [opts.id]);
  if (rows.length === 0) throw new SubmissionError("Vain luonnoksen voi poistaa.");
  await audit(tx, { organizationId: rows[0].organization_id, userId: opts.userId, action: "htj_submission_discard", entity: "htj_submission", entityId: opts.id });
}

export interface SendResult {
  status: "accepted" | "rejected" | "error";
  messages: string[];
}

/** Lähettää hyväksytyn ilmoituksen HTJ:hin. */
export async function sendSubmission(tx: Sql, client: HtjClient, opts: { id: string; userId: string | null }): Promise<SendResult> {
  const [sub] = await tx.query<{ id: string; organization_id: string; company_id: string; kind: HtjSubmissionKind; payload: { businessId: string; items: { id: string }[] }; status: string }>(
    "select id, organization_id, company_id, kind, payload, status from er_htj_submissions where id = $1",
    [opts.id],
  );
  if (!sub) throw new SubmissionError("Ilmoitusta ei löytynyt.");
  if (sub.status !== "approved") throw new SubmissionError("Vain hyväksytyn ilmoituksen voi lähettää.");

  const [sync] = await tx.query<{ id: string }>(
    "insert into er_htj_syncs (organization_id, company_id, kind, target, started_by) values ($1,$2,'submit',$3,$4) returning id",
    [sub.organization_id, sub.company_id, sub.kind, opts.userId],
  );
  const ids = sub.payload.items.map((i) => i.id);
  try {
    const result = await withRequestLog(tx, client).submit(sub.payload.businessId, sub.kind, sub.payload, {
      purpose: "htj2_submission", userId: opts.userId, organizationId: sub.organization_id, companyId: sub.company_id, syncId: sync.id,
    });
    const status = result.accepted ? "accepted" : "rejected";
    await tx.query(
      "update er_htj_submissions set status = $2, sent_at = now(), response = $3, error = $4 where id = $1",
      [sub.id, status, JSON.stringify({ reference: result.reference, itemRefs: result.itemRefs, messages: result.messages }), result.accepted ? null : result.messages.join(" ").slice(0, 500)],
    );
    if (result.accepted) await markRowsSubmitted(tx, sub.company_id, sub.kind, ids, result.itemRefs);
    await tx.query("update er_htj_syncs set status = $2, finished_at = now(), summary = $3 where id = $1", [
      sync.id, result.accepted ? "ok" : "warnings", JSON.stringify({ items: ids.length, reference: result.reference, messages: result.messages }),
    ]);
    await audit(tx, { organizationId: sub.organization_id, userId: opts.userId, action: `htj_submission_${status}`, entity: "htj_submission", entityId: sub.id, details: { kind: sub.kind, items: ids.length } });
    return { status, messages: result.messages };
  } catch (err) {
    if (!(err instanceof HtjError)) throw err;
    await tx.query("update er_htj_submissions set error = $2 where id = $1", [sub.id, err.message]);
    await tx.query("update er_htj_syncs set status = 'error', finished_at = now(), error = $2 where id = $1", [sync.id, err.message]);
    return { status: "error", messages: [err.message] };
  }
}

/**
 * Merkitsee yhtiön HTJ2-tiedot käsin ilmoitetuiksi (MML:n asiointipalvelussa
 * tehty ilmoitus). Jokaisesta lajista, jossa oli ilmoittamattomia rivejä,
 * syntyy jonoon rivi tilassa `manual_done`, jotta jäljistä näkyy, mitä
 * ilmoitettiin ja kuka merkitsi. Avoimet luonnokset poistetaan tarpeettomina.
 */
export async function markManualDone(tx: Sql, opts: { companyId: string; userId: string; note?: string | null; today?: string }): Promise<number> {
  const data = await loadHtj2Data(tx, opts.companyId, opts.today ?? isoDateHelsinki());
  if (!data) throw new SubmissionError("Yhtiötä ei löytynyt.");
  const pending = unsubmittedRows(data);
  let created = 0;
  for (const kind of SUBMISSION_KINDS) {
    if (pending[kind].length === 0) continue;
    const payload = buildPayload(kind, data);
    const rows = await tx.query<{ id: string }>(
      `insert into er_htj_submissions (organization_id, company_id, kind, payload, status, prepared_by, approved_by, approved_at, note)
       values ($1,$2,$3,$4,'manual_done',$5,$5,now(),$6) returning id`,
      [data.company.organization_id, opts.companyId, kind, JSON.stringify(payload), opts.userId, opts.note ?? null],
    );
    await markRowsSubmitted(tx, opts.companyId, kind, pending[kind].map((r) => r.id));
    await tx.query("delete from er_htj_submissions where company_id = $1 and kind = $2 and status = 'draft'", [opts.companyId, kind]);
    created += rows.length;
  }
  if (created === 0) throw new SubmissionError("Kaikki rivit on jo merkitty ilmoitetuiksi.");
  await audit(tx, { organizationId: data.company.organization_id, userId: opts.userId, action: "htj_manual_done", entity: "housing_company", entityId: opts.companyId, details: { kinds: created } });
  return created;
}
