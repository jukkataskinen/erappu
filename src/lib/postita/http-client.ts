import { POSTITA_JOB_STATUSES, PostitaError, type PostitaClient, type PostitaJob, type PostitaJobStatus, type UploadInput } from "./types";

/**
 * Postitan oikea rajapinta. Basic-tunnistus samoilla tunnuksilla kuin
 * verkkopalvelussa (UTF-8). Lataus `application/x-www-form-urlencoded`,
 * PDF URL-turvallisena base64:nä täytemerkkeineen (RFC 4648).
 */
export class PostitaHttpClient implements PostitaClient {
  readonly mode = "http" as const;
  private readonly auth: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: { username: string; password: string; baseUrl?: string; timeoutMs?: number }) {
    this.auth = `Basic ${Buffer.from(`${opts.username}:${opts.password}`, "utf8").toString("base64")}`;
    this.baseUrl = (opts.baseUrl ?? "https://postita.fi/api/").replace(/\/?$/, "/");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async upload(input: UploadInput): Promise<PostitaJob> {
    const body = await this.call("send/", {
      job_name: input.jobName,
      pdf: toUrlSafeBase64(input.pdf),
      post_class: String(input.postClass),
      pdf_splitter: String(input.pagesPerLetter),
      // Ilman tätä Postita lähettää työn automaattisesti.
      confirm: "false",
    });
    const job = toJob(first(body), { status: "NE" });
    if (!job.id) throw new PostitaError("bad_response", "Postita ei palauttanut työn tunnusta.");
    return job;
  }

  async confirm(jobId: string): Promise<PostitaJob> {
    // Onnistunut vahvistus ilman tilaa vastauksessa on vahvistettu työ: muuten
    // postitettava työ näkyisi eRapussa vahvistamattomana ja se yritettäisiin uudelleen.
    return toJob(first(await this.call(`confirm/${encodeURIComponent(jobId)}/`, {})), { id: jobId, status: "CO" });
  }

  async cancel(jobId: string): Promise<void> {
    await this.call(`delete/${encodeURIComponent(jobId)}/`, {});
  }

  async jobInfo(jobId: string): Promise<PostitaJob> {
    return toJob(first(await this.call(`job_info/${encodeURIComponent(jobId)}/`)), { id: jobId });
  }

  private async call(path: string, form?: Record<string, string>): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method: form ? "POST" : "GET",
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PostitaError("unavailable", "Postitaan ei saatu yhteyttä. Yritä hetken kuluttua uudelleen.");
    }
    const text = await res.text();
    // Vastauksen sisältöä ei kopioida viestiin (ks. PostitaError).
    if (res.status === 401) throw new PostitaError("unauthorized", "Postita hylkäsi tunnukset. Tarkista käyttäjätunnus ja salasana.", 401);
    if (res.status === 404) throw new PostitaError("not_found", "Työtä ei löytynyt Postitasta.", 404);
    if (res.status === 409) {
      throw new PostitaError("rejected", "Postita hylkäsi pyynnön: tilin saldo ei riitä, työ on jo käsittelyssä tai jokin arvo on virheellinen.", 409);
    }
    if (res.status === 400 || res.status === 415) throw new PostitaError("rejected", `Postita hylkäsi pyynnön (${res.status}).`, res.status);
    if (!res.ok) throw new PostitaError("unavailable", `Postita vastasi virheellä ${res.status}.`, res.status);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PostitaError("bad_response", "Postitan vastausta ei voitu tulkita.");
    }
  }
}

/** URL-turvallinen base64 täytemerkkeineen (RFC 4648 luku 5). */
export function toUrlSafeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function first(body: unknown): Record<string, unknown> {
  const row = Array.isArray(body) ? body[0] : body;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function toJob(r: Record<string, unknown>, fallback: { id?: string; status?: PostitaJobStatus } = {}): PostitaJob {
  const status = String(r.status ?? fallback.status ?? "");
  if (!(POSTITA_JOB_STATUSES as readonly string[]).includes(status)) {
    throw new PostitaError("bad_response", "Postita palautti tuntemattoman tilan.");
  }
  return {
    id: String(r.id ?? fallback.id ?? ""),
    status: status as PostitaJobStatus,
    price: num(r.price),
    recipientCount: num(r.recipient_count),
    totalPages: num(r.total_pages),
  };
}
