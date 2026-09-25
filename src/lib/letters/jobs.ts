import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isPostitaError, type PostClass, type PostitaClient, type PostitaJob } from "@/lib/postita";
import { buildLetterBatch, LetterPdfError, type LetterContent } from "./pdf";

/**
 * Kirjetyöt Postitaan. Kulku (sama kuin Mittarilukemassa):
 *   1. PDF muodostetaan ennen kuin mitään varataan.
 *   2. Vastaanottajat varataan työlle yhdessä transaktiossa (er_letters,
 *      osittainen uniikki indeksi): rinnakkainen tai toistettu lataus ei voi
 *      tehdä samalle osakkaalle toista kirjettä.
 *   3. Lataus Postitaan vahvistamattomana (NE). Jos se epäonnistuu, työ
 *      merkitään epäonnistuneeksi ja varaukset puretaan.
 *   4. Vahvistus tai peruutus erikseen, kun vedos on tarkistettu.
 * Tapahtumalokiin vain määrät ja tunnisteet, ei nimiä eikä osoitteita.
 */

export type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
export type LetterSubjectTable = "er_meetings" | "er_announcements";

export class LetterError extends Error {}

export interface LetterRecipientRow {
  partyId: string;
  name: string;
  addressLines: string[];
  reference: string | null;
}

export interface LetterSource {
  organizationId: string;
  companyId: string;
  subjectTable: LetterSubjectTable;
  subjectId: string;
  /** Työn nimi Postitassa. Ei henkilötietoja. */
  jobName: string;
  sender: string[];
  date: string;
  content: LetterContent;
  appendix: Uint8Array | null;
  /** Vastaanottajat, joille ei vielä ole voimassa olevaa kirjettä. */
  recipients: LetterRecipientRow[];
}

export interface LetterJobRow {
  id: string;
  provider: "mock" | "postita";
  provider_job_id: string | null;
  status: "uploading" | "NE" | "CO" | "PR" | "SE" | "CA" | "failed";
  post_class: PostClass;
  letter_count: number;
  pages_per_letter: number;
  price: string | null;
  created_at: string;
  created_by_name: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  cancelled_at: string | null;
}

export interface LetterRow {
  party_id: string;
  status: "reserved" | "confirmed" | "cancelled";
  job_id: string;
}

/** Keskeytynyt lataus (esim. palvelin kaatui) ei saa estää uutta latausta pysyvästi. */
const STALE_UPLOAD_MINUTES = 15;

const PROVIDER = { http: "postita", mock: "mock" } as const;

export async function listLetterJobs(tx: Sql, subjectTable: LetterSubjectTable, subjectId: string): Promise<LetterJobRow[]> {
  return tx.query<LetterJobRow>(
    `select j.id, j.provider, j.provider_job_id, j.status, j.post_class, j.letter_count, j.pages_per_letter, j.price::text as price,
            j.created_at, coalesce(cu.full_name, cu.email) as created_by_name, j.confirmed_at, coalesce(fu.full_name, fu.email) as confirmed_by_name, j.cancelled_at
       from er_letter_jobs j
       left join er_users cu on cu.id = j.created_by
       left join er_users fu on fu.id = j.confirmed_by
      where j.subject_table = $1 and j.subject_id = $2
      order by j.created_at desc`,
    [subjectTable, subjectId],
  );
}

/** Voimassa olevat (varatut ja postitetut) kirjeet osapuolittain. */
export async function listActiveLetters(tx: Sql, subjectTable: LetterSubjectTable, subjectId: string): Promise<LetterRow[]> {
  return tx.query<LetterRow>(
    "select party_id, status, job_id from er_letters where subject_table = $1 and subject_id = $2 and status <> 'cancelled'",
    [subjectTable, subjectId],
  );
}

async function releaseStaleUploads(tx: Sql, subjectTable: LetterSubjectTable, subjectId: string) {
  const stale = await tx.query<{ id: string }>(
    `update er_letter_jobs set status = 'failed', updated_at = now()
      where subject_table = $1 and subject_id = $2 and status = 'uploading' and created_at < now() - make_interval(mins => $3)
      returning id`,
    [subjectTable, subjectId, STALE_UPLOAD_MINUTES],
  );
  if (stale.length) await tx.query("update er_letters set status = 'cancelled' where job_id = any($1::uuid[])", [stale.map((s) => s.id)]);
}

export async function uploadLetters(
  run: Runner,
  client: PostitaClient,
  input: { userId: string; source: LetterSource; postClass: PostClass },
): Promise<{ jobId: string; letters: number; job: PostitaJob }> {
  const { source } = input;
  if (source.recipients.length === 0) throw new LetterError("Ei lähetettäviä kirjeitä.");

  let built: { pdf: Uint8Array; pagesPerLetter: number };
  try {
    built = await buildLetterBatch({ sender: source.sender, date: source.date, content: source.content, recipients: source.recipients, appendix: source.appendix });
  } catch (err) {
    if (err instanceof LetterPdfError) throw new LetterError(err.message);
    throw err;
  }

  const jobId = await run(async (tx) => {
    await releaseStaleUploads(tx, source.subjectTable, source.subjectId);
    const open = await tx.query<{ status: string }>(
      "select status from er_letter_jobs where subject_table = $1 and subject_id = $2 and status in ('uploading', 'NE')",
      [source.subjectTable, source.subjectId],
    );
    if (open.length) throw new LetterError("Kirjeet odottavat jo vahvistusta. Vahvista tai peru edellinen työ ensin.");
    const [job] = await tx.query<{ id: string }>(
      `insert into er_letter_jobs (organization_id, company_id, subject_table, subject_id, provider, post_class, letter_count, pages_per_letter, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [source.organizationId, source.companyId, source.subjectTable, source.subjectId, PROVIDER[client.mode], input.postClass, source.recipients.length,
        built.pagesPerLetter, input.userId],
    );
    try {
      for (const r of source.recipients) {
        await tx.query(
          `insert into er_letters (organization_id, job_id, subject_table, subject_id, party_id, recipient_name, address_lines)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [source.organizationId, job.id, source.subjectTable, source.subjectId, r.partyId, r.name, r.addressLines],
        );
      }
    } catch (err) {
      // Toinen käyttäjä ehti varata saman osakkaan kirjeen.
      if ((err as { code?: string }).code === "23505") throw new LetterError("Osa kirjeistä on jo ladattu. Päivitä sivu ja yritä uudelleen.");
      throw err;
    }
    return job.id;
  });

  let job: PostitaJob;
  try {
    job = await client.upload({ jobName: source.jobName, pdf: built.pdf, pagesPerLetter: built.pagesPerLetter, letterCount: source.recipients.length, postClass: input.postClass });
  } catch (err) {
    await run(async (tx) => {
      await tx.query("update er_letter_jobs set status = 'failed', updated_at = now() where id = $1", [jobId]);
      await tx.query("update er_letters set status = 'cancelled' where job_id = $1", [jobId]);
      await audit(tx, {
        organizationId: source.organizationId, userId: input.userId, action: "letters_upload_failed", entity: "letter_job", entityId: jobId,
        details: { subject: source.subjectTable, subjectId: source.subjectId, letters: source.recipients.length, code: isPostitaError(err) ? err.code : "error" },
      });
    });
    if (isPostitaError(err)) throw new LetterError(err.message);
    throw err;
  }

  await run(async (tx) => {
    await tx.query("update er_letter_jobs set provider_job_id = $2, status = $3, price = $4, updated_at = now() where id = $1", [jobId, job.id, job.status, job.price]);
    // Jos Postita vahvisti työn heti (tilin asetus), kirjeet ovat jo matkalla.
    if (job.status !== "NE" && job.status !== "CA") await tx.query("update er_letters set status = 'confirmed' where job_id = $1", [jobId]);
    if (job.status === "CA") await tx.query("update er_letters set status = 'cancelled' where job_id = $1", [jobId]);
    await audit(tx, {
      organizationId: source.organizationId, userId: input.userId, action: "letters_upload", entity: "letter_job", entityId: jobId,
      details: { subject: source.subjectTable, subjectId: source.subjectId, letters: source.recipients.length, pagesPerLetter: built.pagesPerLetter, postClass: input.postClass, provider: client.mode, status: job.status },
    });
  });
  return { jobId, letters: source.recipients.length, job };
}

async function loadJob(run: Runner, jobId: string) {
  const [job] = await run((tx) =>
    tx.query<{ id: string; organization_id: string; provider: string; provider_job_id: string | null; status: string; subject_table: string; subject_id: string }>(
      "select id, organization_id, provider, provider_job_id, status, subject_table, subject_id from er_letter_jobs where id = $1",
      [jobId],
    ),
  );
  if (!job) throw new LetterError("Kirjetyötä ei löytynyt.");
  return job;
}

function assertProvider(client: PostitaClient, provider: string) {
  if (PROVIDER[client.mode] !== provider) {
    throw new LetterError(provider === "mock" ? "Työ on tehty kirjepalvelun testitilassa, eikä sitä voi käsitellä oikeassa palvelussa. Peru työ ja lataa kirjeet uudelleen." : "Kirjepalvelu on testitilassa, eikä oikeaa työtä voi käsitellä.");
  }
}

/** Vahvistaa työn postitettavaksi. Varatut kirjeet merkitään postitetuiksi. */
export async function confirmLetters(run: Runner, client: PostitaClient, input: { userId: string; jobId: string }): Promise<number> {
  const job = await loadJob(run, input.jobId);
  if (job.status !== "NE" || !job.provider_job_id) throw new LetterError("Vain vahvistamattoman työn voi vahvistaa.");
  assertProvider(client, job.provider);
  let result: PostitaJob;
  try {
    result = await client.confirm(job.provider_job_id);
  } catch (err) {
    if (isPostitaError(err)) throw new LetterError(err.message);
    throw err;
  }
  return run(async (tx) => {
    await tx.query(
      "update er_letter_jobs set status = $2, price = coalesce($3, price), confirmed_at = now(), confirmed_by = $4, updated_at = now() where id = $1",
      [job.id, result.status === "NE" ? "CO" : result.status, result.price, input.userId],
    );
    const rows = await tx.query("update er_letters set status = 'confirmed' where job_id = $1 and status = 'reserved' returning id", [job.id]);
    await audit(tx, { organizationId: job.organization_id, userId: input.userId, action: "letters_confirm", entity: "letter_job", entityId: job.id, details: { letters: rows.length, status: result.status } });
    return rows.length;
  });
}

/** Peruu työn ennen käsittelyä. Kirjeet palaavat lähettämättömiksi. */
export async function cancelLetters(run: Runner, client: PostitaClient, input: { userId: string; jobId: string }): Promise<void> {
  const job = await loadJob(run, input.jobId);
  if ((job.status !== "NE" && job.status !== "CO") || !job.provider_job_id) throw new LetterError("Työtä ei voi enää perua.");
  // Testitilan työn voi perua aina: Postitassa ei ole mitään peruttavaa.
  if (job.provider !== "mock") {
    assertProvider(client, job.provider);
    try {
      await client.cancel(job.provider_job_id);
    } catch (err) {
      if (isPostitaError(err)) throw new LetterError(err.message);
      throw err;
    }
  }
  await run(async (tx) => {
    await tx.query("update er_letter_jobs set status = 'CA', cancelled_at = now(), cancelled_by = $2, updated_at = now() where id = $1", [job.id, input.userId]);
    await tx.query("update er_letters set status = 'cancelled' where job_id = $1", [job.id]);
    await audit(tx, { organizationId: job.organization_id, userId: input.userId, action: "letters_cancel", entity: "letter_job", entityId: job.id, details: { previous: job.status } });
  });
}

/**
 * Päivittää tilan Postitasta. Työ on voitu vahvistaa tai perua myös Postitan
 * omassa palvelussa, joten kirjeiden tila seuraa työn tilaa.
 */
export async function refreshLetterJob(run: Runner, client: PostitaClient, input: { userId: string; jobId: string }): Promise<string> {
  const job = await loadJob(run, input.jobId);
  if (!job.provider_job_id || job.status === "failed" || job.status === "uploading") return job.status;
  assertProvider(client, job.provider);
  let info: PostitaJob;
  try {
    info = await client.jobInfo(job.provider_job_id);
  } catch (err) {
    if (isPostitaError(err)) throw new LetterError(err.message);
    throw err;
  }
  if (info.status === job.status) return job.status;
  await run(async (tx) => {
    await tx.query("update er_letter_jobs set status = $2, price = coalesce($3, price), updated_at = now() where id = $1", [job.id, info.status, info.price]);
    if (info.status === "CA") await tx.query("update er_letters set status = 'cancelled' where job_id = $1", [job.id]);
    else if (info.status !== "NE") await tx.query("update er_letters set status = 'confirmed' where job_id = $1 and status = 'reserved'", [job.id]);
    await audit(tx, { organizationId: job.organization_id, userId: input.userId, action: "letters_status", entity: "letter_job", entityId: job.id, details: { from: job.status, to: info.status } });
  });
  return info.status;
}
