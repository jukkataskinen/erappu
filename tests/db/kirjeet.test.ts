import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";
import type { Database, Sql } from "@/lib/db/types";
import { cancelLetters, confirmLetters, LetterError, refreshLetterJob, uploadLetters, type LetterSource } from "@/lib/letters/jobs";
import { loadMeetingLetterSource, planMeetingLetters } from "@/lib/letters/meeting";
import { planAnnouncementLetters } from "@/lib/letters/announcement";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { PostitaError, type PostitaClient } from "@/lib/postita";
import { PostitaMockClient } from "@/lib/postita/mock";

/**
 * Paperikirjeet Postitan kautta: organisaatioeristys (RLS), varaus ilman
 * tuplakirjeitä, vahvistus, peruutus ja epäonnistuneen latauksen palautus.
 */
let db: Database;
let f: Fixture;
let meetingId: string;
let paperParty: string;
let noAddressParty: string;
let storagePath: string;

const runAs = (sub: string) => <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(sub, fn);

async function notice(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  const stored = await storeFile({ organizationId: f.orgA, companyId: f.companyA, fileName: "kokouskutsu-2026-10-12.pdf", mimeType: "application/pdf", bytes: await notice(2) });
  storagePath = stored.storagePath;
  await db.asService(async (tx) => {
    await tx.query(
      `update er_organizations set settings = settings || '{"contact": {"street_address": "Toimistokatu 1", "postal_code": "40100", "city": "Jyväskylä"}, "letter_prices": {"class1_eur": 3.9, "class2_eur": 2.9, "extra_page_eur": 0.2}}'::jsonb where id = $1`,
      [f.orgA],
    );
    const g1 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 1') returning id", [f.orgA, f.companyA])).id;
    const g2 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 2') returning id", [f.orgA, f.companyA])).id;
    const g3 = (await one<{ id: string }>(tx, "insert into er_share_groups (organization_id, company_id, unit_label) values ($1,$2,'A 3') returning id", [f.orgA, f.companyA])).id;
    const electronic = (await one<{ id: string }>(tx,
      "insert into er_parties (organization_id, first_names, last_name, email, electronic_notice_consent) values ($1,'Olli','Osakas','olli@example.test',true) returning id", [f.orgA])).id;
    paperParty = (await one<{ id: string }>(tx,
      "insert into er_parties (organization_id, first_names, last_name, street_address, postal_code, city) values ($1,'Pekka','Paperi','Kotikatu 1 A 2','41660','Toivakka') returning id", [f.orgA])).id;
    noAddressParty = (await one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name) values ($1,'Oona','Osoitteeton') returning id", [f.orgA])).id;
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, source) values ($1,$2,$3,'manual'),($1,$4,$5,'manual'),($1,$6,$7,'manual')", [
      f.orgA, g1, electronic, g2, paperParty, g3, noAddressParty,
    ]);
    meetingId = (await one<{ id: string }>(tx,
      "insert into er_meetings (organization_id, company_id, kind, starts_at, status) values ($1,$2,'annual_general', now() + interval '20 days', 'notice_sent') returning id", [f.orgA, f.companyA])).id;
    await tx.query(
      `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, subject_table, subject_id)
       values ($1,$2,'meeting_notice','Kokouskutsu','kokouskutsu-2026-10-12.pdf',$3,'application/pdf',$4,$5,'owners','er_meetings',$6)`,
      [f.orgA, f.companyA, stored.storagePath, stored.sizeBytes, stored.sha256, meetingId],
    );
  });
});
afterAll(async () => {
  await deleteStoredFile(storagePath);
  await db.close();
});

describe("kokouskutsun kirjeet", () => {
  it("paperikutsun saa vain osoitteellinen osakas ilman sähköistä kutsua", async () => {
    const plan = await runAs(f.managerA.sub)((tx) => planMeetingLetters(tx, meetingId));
    expect(plan?.blocker).toBeNull();
    expect(plan?.paper.map((p) => p.party.party_id).sort()).toEqual([paperParty, noAddressParty].sort());
    expect(plan?.ready.map((r) => r.partyId)).toEqual([paperParty]);
    expect(plan?.ready[0]).toMatchObject({ addressLines: ["Pekka Paperi", "Kotikatu 1 A 2", "41660 Toivakka"], reference: "Kohde: A 2" });
    expect(plan?.sender.lines).toEqual(["As Oy Testi A", "c/o Isännöinti A", "Toimistokatu 1", "40100 Jyväskylä"]);
  });

  it("lataus, vahvistus ja uudelleenlatauksen esto", async () => {
    const run = runAs(f.managerA.sub);
    const client = new PostitaMockClient();
    const source = await loadMeetingLetterSource(run, meetingId);
    const up = await uploadLetters(run, client, { userId: f.managerA.id, source, postClass: 2 });
    expect(up.letters).toBe(1);
    // Etusivu + kaksisivuinen kutsu.
    expect(client.jobs.get(up.job.id)?.totalPages).toBe(3);

    const [job] = await run((tx) => tx.query<{ status: string; pages_per_letter: number; provider: string }>("select status, pages_per_letter, provider from er_letter_jobs where id = $1", [up.jobId]));
    expect(job).toEqual({ status: "NE", pages_per_letter: 3, provider: "mock" });

    // Toinen lataus ennen vahvistusta estetään.
    await expect(loadMeetingLetterSource(run, meetingId)).rejects.toThrow(/odottaa vahvistusta/);
    await expect(uploadLetters(run, client, { userId: f.managerA.id, source, postClass: 2 })).rejects.toBeInstanceOf(LetterError);

    // Ilman kirjehintaa postitusta ei vahvisteta, koska se laskutetaan taloyhtiöltä.
    await db.asService((tx) => tx.query("update er_organizations set settings = settings - 'letter_prices' where id = $1", [f.orgA]));
    await expect(confirmLetters(run, client, { userId: f.managerA.id, jobId: up.jobId })).rejects.toThrow(/kirjeiden hinnat/);
    expect(client.jobs.get(up.job.id)?.status).toBe("NE");
    await db.asService((tx) =>
      tx.query(`update er_organizations set settings = settings || '{"letter_prices": {"class1_eur": 3.9, "class2_eur": 2.9, "extra_page_eur": 0.2}}'::jsonb where id = $1`, [f.orgA]),
    );

    expect(await confirmLetters(run, client, { userId: f.managerA.id, jobId: up.jobId })).toBe(1);
    // Veloitus lukittu: 1 kirje × 2,90 + 2 lisäsivua × 0,20.
    const [charged] = await run((tx) => tx.query<{ charge_total_eur: string; description: string }>("select charge_total_eur::text, description from er_letter_jobs where id = $1", [up.jobId]));
    expect(charged).toEqual({ charge_total_eur: "3.30", description: expect.stringMatching(/^Kokouskutsu: varsinainen yhtiökokous /) });
    const letters = await run((tx) => tx.query<{ status: string; address_lines: string[] }>("select status, address_lines from er_letters where job_id = $1", [up.jobId]));
    expect(letters).toEqual([{ status: "confirmed", address_lines: ["Pekka Paperi", "Kotikatu 1 A 2", "41660 Toivakka"] }]);

    // Postitettu osakas ei saa toista kirjettä, vaikka lähde olisi vanha.
    await expect(uploadLetters(run, client, { userId: f.managerA.id, source, postClass: 2 })).rejects.toThrow(/jo ladattu/);
    const after = await run((tx) => planMeetingLetters(tx, meetingId));
    expect(after?.ready).toEqual([]);

    const log = await db.asService((tx) => tx.query<{ action: string; details: Record<string, unknown> }>("select action, details from er_audit_log where entity = 'letter_job' order by created_at"));
    expect(log.map((l) => l.action)).toEqual(["letters_upload", "letters_confirm"]);
    expect(JSON.stringify(log)).not.toMatch(/Pekka|Kotikatu/);
  });
});

describe("peruutus ja epäonnistuminen", () => {
  const subject = () => crypto.randomUUID();
  const source = (subjectId: string): LetterSource => ({
    organizationId: f.orgA,
    companyId: f.companyA,
    subjectTable: "er_announcements",
    subjectId,
    jobName: "As Oy Testi A: tiedote",
    description: "Tiedote: Vesikatko",
    sender: ["As Oy Testi A", "c/o Isännöinti A", "Toimistokatu 1", "40100 Jyväskylä"],
    date: "2026-09-25",
    content: { title: "Tiedote", paragraphs: ["Teksti."], signature: [], footer: "Isännöinti A" },
    appendix: null,
    recipients: [{ partyId: paperParty, name: "Pekka Paperi", addressLines: ["Pekka Paperi", "Kotikatu 1 A 2", "41660 Toivakka"], reference: null }],
  });

  it("peruttu työ vapauttaa vastaanottajat uuteen lataukseen", async () => {
    const run = runAs(f.managerA.sub);
    const client = new PostitaMockClient();
    const s = source(subject());
    const up = await uploadLetters(run, client, { userId: f.managerA.id, source: s, postClass: 1 });
    await cancelLetters(run, client, { userId: f.managerA.id, jobId: up.jobId });
    const [job] = await run((tx) => tx.query<{ status: string }>("select status from er_letter_jobs where id = $1", [up.jobId]));
    expect(job.status).toBe("CA");
    const again = await uploadLetters(run, client, { userId: f.managerA.id, source: s, postClass: 1 });
    expect(again.letters).toBe(1);
  });

  it("epäonnistunut lataus puretaan, eikä virhe paljasta vastaanottajia", async () => {
    const run = runAs(f.managerA.sub);
    const failing: PostitaClient = {
      mode: "http",
      upload: async () => {
        throw new PostitaError("rejected", "Postita hylkäsi pyynnön: tilin saldo ei riitä, työ on jo käsittelyssä tai jokin arvo on virheellinen.", 409);
      },
      confirm: async () => { throw new Error("ei kutsuta"); },
      cancel: async () => { throw new Error("ei kutsuta"); },
      jobInfo: async () => { throw new Error("ei kutsuta"); },
    };
    const s = source(subject());
    const err = await uploadLetters(run, failing, { userId: f.managerA.id, source: s, postClass: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(LetterError);
    expect(String(err.message)).toMatch(/saldo ei riitä/);
    expect(String(err.message)).not.toMatch(/Pekka|Kotikatu/);
    const rows = await run((tx) => tx.query<{ status: string; letters: string[] }>(
      "select j.status, array_agg(l.status) as letters from er_letter_jobs j join er_letters l on l.job_id = j.id where j.subject_id = $1 group by j.status", [s.subjectId]));
    expect(rows).toEqual([{ status: "failed", letters: ["cancelled"] }]);
    // Uusi yritys onnistuu.
    expect((await uploadLetters(run, new PostitaMockClient(), { userId: f.managerA.id, source: s, postClass: 2 })).letters).toBe(1);
  });

  it("testitilan työtä ei käsitellä oikealla palvelulla", async () => {
    const run = runAs(f.managerA.sub);
    const up = await uploadLetters(run, new PostitaMockClient(), { userId: f.managerA.id, source: source(subject()), postClass: 2 });
    const real = { ...new PostitaMockClient(), mode: "http" as const } as unknown as PostitaClient;
    await expect(confirmLetters(run, real, { userId: f.managerA.id, jobId: up.jobId })).rejects.toThrow(/testitilassa/);
    await expect(refreshLetterJob(run, real, { userId: f.managerA.id, jobId: up.jobId })).rejects.toThrow(/testitilassa/);
  });
});

describe("kirjeiden RLS", () => {
  it("toinen organisaatio ei näe kirjetöitä eikä kirjeitä", async () => {
    const jobs = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_letter_jobs"));
    const letters = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_letters"));
    expect(jobs).toEqual([]);
    expect(letters).toEqual([]);
    const own = await db.asUser(f.managerA.sub, (tx) => tx.query("select id from er_letter_jobs"));
    expect(own.length).toBeGreaterThan(0);
    const plan = await db.asUser(f.managerB.sub, (tx) => planMeetingLetters(tx, meetingId));
    expect(plan).toBeNull();
  });

  it("toinen organisaatio ei voi muuttaa eikä luoda kirjetöitä toisen yhtiöön", async () => {
    const upd = await db.asUser(f.managerB.sub, (tx) => tx.query("update er_letter_jobs set status = 'CA' returning id"));
    expect(upd).toEqual([]);
    await expect(
      db.asUser(f.managerB.sub, (tx) =>
        tx.query("insert into er_letter_jobs (organization_id, company_id, subject_table, subject_id, provider, post_class, letter_count, pages_per_letter) values ($1,$2,'er_meetings',$3,'mock',2,1,1)", [
          f.orgA, f.companyA, meetingId,
        ]),
      ),
    ).rejects.toThrow();
    // Oman organisaation työhön ei voi liittää toisen yhtiön kohdetta: yhtiön on oltava samassa organisaatiossa.
    await expect(
      db.asUser(f.managerB.sub, (tx) =>
        tx.query("insert into er_letter_jobs (organization_id, company_id, subject_table, subject_id, provider, post_class, letter_count, pages_per_letter) values ($1,$2,'er_meetings',$3,'mock',2,1,1)", [
          f.orgB, f.companyA, meetingId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("kirjanpitäjä näkee kirjeet mutta ei voi ladata niitä", async () => {
    const read = await db.asUser(f.accountantA.sub, (tx) => tx.query("select id from er_letter_jobs"));
    expect(read.length).toBeGreaterThan(0);
    await expect(
      db.asUser(f.accountantA.sub, (tx) =>
        tx.query("insert into er_letter_jobs (organization_id, company_id, subject_table, subject_id, provider, post_class, letter_count, pages_per_letter) values ($1,$2,'er_meetings',$3,'mock',2,1,1)", [
          f.orgA, f.companyA, meetingId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("toisen organisaation osakasta ei voi liittää kirjeeseen", async () => {
    const partyB = await db.asService((tx) => one<{ id: string }>(tx, "insert into er_parties (organization_id, first_names, last_name) values ($1,'Bert','Toinen') returning id", [f.orgB]));
    const [job] = await db.asUser(f.managerA.sub, (tx) => tx.query<{ id: string; subject_id: string }>("select id, subject_id from er_letter_jobs where subject_table = 'er_meetings' limit 1"));
    await expect(
      db.asUser(f.managerA.sub, (tx) =>
        tx.query("insert into er_letters (organization_id, job_id, subject_table, subject_id, party_id, recipient_name, address_lines) values ($1,$2,'er_meetings',$3,$4,'x','{a,b}')", [
          f.orgA, job.id, job.subject_id, partyB.id,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("tiedotteen kirjeet", () => {
  it("kirje niille, joilla ei ole sähköpostia, vain sähköpostilla julkaistusta tiedotteesta", async () => {
    const id = await db.asService(async (tx) =>
      (await one<{ id: string }>(tx,
        `insert into er_announcements (organization_id, company_id, title, body, audience_roles, channels, status, published_at)
         values ($1,$2,'Vesikatko','Vesi on poikki.

Pahoittelemme.',array['owner'],array['portal','email'],'published',now()) returning id`, [f.orgA, f.companyA])).id,
    );
    const plan = await runAs(f.managerA.sub)((tx) => planAnnouncementLetters(tx, id));
    expect(plan?.blocker).toBeNull();
    expect(plan?.paper.map((p) => p.partyId).sort()).toEqual([paperParty, noAddressParty].sort());
    expect(plan?.ready.map((r) => r.partyId)).toEqual([paperParty]);

    await db.asService((tx) => tx.query("update er_announcements set channels = array['portal'] where id = $1", [id]));
    const portalOnly = await runAs(f.managerA.sub)((tx) => planAnnouncementLetters(tx, id));
    expect(portalOnly?.blocker).toMatch(/sähköpostilla/);
  });
});
