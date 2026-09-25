import { PostitaError, type PostitaClient, type PostitaJob, type UploadInput } from "./types";

/**
 * Postitan jäljitelmä: mitään ei tulosteta eikä lähetetä. Työt ovat
 * muistissa. Kehityspalvelin voi ladata moduulin uudelleen pyyntöjen välillä,
 * joten tuntematon `mock-`-tunnus hyväksytään vahvistamattomana työnä.
 */
export class PostitaMockClient implements PostitaClient {
  readonly mode = "mock" as const;
  readonly jobs = new Map<string, PostitaJob & { pdfBytes: number }>();
  private counter = 0;

  async upload(input: UploadInput): Promise<PostitaJob> {
    const id = `mock-${Date.now().toString(36)}-${++this.counter}`;
    const job = { id, status: "NE" as const, price: null, recipientCount: input.letterCount, totalPages: input.letterCount * input.pagesPerLetter, pdfBytes: input.pdf.length };
    this.jobs.set(id, job);
    return strip(job);
  }

  async confirm(jobId: string): Promise<PostitaJob> {
    const job = this.find(jobId);
    if (job.status !== "NE") throw new PostitaError("rejected", "Postita hylkäsi pyynnön: työ ei ole vahvistamaton.", 409);
    job.status = "CO";
    return strip(job);
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.find(jobId);
    if (job.status !== "NE" && job.status !== "CO") throw new PostitaError("rejected", "Postita hylkäsi pyynnön: työ on jo käsittelyssä.", 409);
    job.status = "CA";
  }

  async jobInfo(jobId: string): Promise<PostitaJob> {
    return strip(this.find(jobId));
  }

  private find(jobId: string) {
    let job = this.jobs.get(jobId);
    if (!job && jobId.startsWith("mock-")) {
      job = { id: jobId, status: "NE", price: null, recipientCount: null, totalPages: null, pdfBytes: 0 };
      this.jobs.set(jobId, job);
    }
    if (!job) throw new PostitaError("not_found", "Työtä ei löytynyt Postitasta.", 404);
    return job;
  }
}

function strip(job: PostitaJob & { pdfBytes: number }): PostitaJob {
  return { id: job.id, status: job.status, price: job.price, recipientCount: job.recipientCount, totalPages: job.totalPages };
}
