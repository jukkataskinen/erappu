import type { Sql } from "@/lib/db";
import type { HtjClient } from "./client";
import { HtjError, type HtjCallMeta, type HtjScope } from "./types";

/**
 * Hakuloki. MML:n ehtojen mukaan jokainen HTJ-haku kirjataan omaan
 * järjestelmään: kuka, milloin, mitä yhtiötä, mihin tarkoitukseen ja suppea
 * vai laaja haku. Lokiin ei kirjoiteta vastauksen sisältöä eikä
 * henkilötietoja, vain rivimäärä ja lopputulos.
 *
 * Loki kirjoitetaan samaan transaktioon kuin synkronointi. Jos haku
 * epäonnistuu, rivi kirjoitetaan silti ja virhe heitetään eteenpäin;
 * synkronointi merkitsee itsensä virheelliseksi ja transaktio päättyy
 * normaalisti, jolloin lokirivi säilyy.
 */

type Operation = "company" | "share_groups" | "owners" | "restrictions" | "changes" | "submit";

interface LogEntry {
  operation: Operation;
  businessId: string | null;
  scope: HtjScope | null;
  outcome: "ok" | "not_found" | "error";
  httpStatus: number | null;
  resultCount: number | null;
  durationMs: number;
  errorCode: string | null;
}

async function writeLog(tx: Sql, mode: string, meta: HtjCallMeta, e: LogEntry) {
  await tx.query(
    `insert into er_htj_requests (organization_id, company_id, sync_id, user_id, operation, business_id, scope, purpose, mode, outcome, http_status, result_count, duration_ms, error_code)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [meta.organizationId, meta.companyId ?? null, meta.syncId ?? null, meta.userId, e.operation, e.businessId, e.scope, meta.purpose, mode, e.outcome,
      e.httpStatus, e.resultCount, e.durationMs, e.errorCode],
  );
}

export function withRequestLog(tx: Sql, client: HtjClient): HtjClient {
  async function logged<T>(operation: Operation, businessId: string | null, scope: HtjScope | null, meta: HtjCallMeta, fn: () => Promise<T>, count: (r: T) => number | null): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      await writeLog(tx, client.mode, meta, {
        operation, businessId, scope, outcome: result === null ? "not_found" : "ok", httpStatus: 200, resultCount: count(result), durationMs: Date.now() - started, errorCode: null,
      });
      return result;
    } catch (err) {
      const htj = err instanceof HtjError ? err : null;
      await writeLog(tx, client.mode, meta, {
        operation, businessId, scope, outcome: htj?.code === "not_found" ? "not_found" : "error", httpStatus: htj?.httpStatus ?? null, resultCount: null,
        durationMs: Date.now() - started, errorCode: htj?.code ?? "unknown",
      });
      throw err;
    }
  }
  const len = (r: unknown[]) => r.length;

  return {
    mode: client.mode,
    getCompany: (bid, meta) => logged("company", bid, null, meta, () => client.getCompany(bid, meta), (r) => (r ? 1 : 0)),
    listShareGroups: (bid, meta) => logged("share_groups", bid, null, meta, () => client.listShareGroups(bid, meta), len),
    listOwners: (bid, scope, meta) => logged("owners", bid, scope, meta, () => client.listOwners(bid, scope, meta), len),
    listRestrictions: (bid, meta) => logged("restrictions", bid, null, meta, () => client.listRestrictions(bid, meta), len),
    listChanges: (since, meta) => logged("changes", null, null, meta, () => client.listChanges(since, meta), len),
    submit: (bid, kind, payload, meta) => logged("submit", bid, null, meta, () => client.submit(bid, kind, payload, meta), (r) => Object.keys(r.itemRefs).length),
  };
}
