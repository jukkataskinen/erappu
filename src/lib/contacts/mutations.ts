import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { prepareAttachments } from "@/lib/maintenance/attachments";
import { storeFile } from "@/lib/storage";
import { MAX_CONTACT_ATTACHMENTS, type ContactTopic } from "./labels";

/**
 * Yhteydenottojen kirjoitukset (0095). RLS tarkistaa oikeudet: portaalikäyttäjä
 * vain omiin ketjuihinsa ja yhtiöihin, joihin hänellä on portaalioikeus,
 * henkilökunta organisaationsa ketjuihin. Sähköposti-ilmoitus lisätään samassa
 * transaktiossa (er_notify_contact_message), eikä viestin sisältöä kopioida siihen.
 */

export class ContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactError";
  }
}

interface ThreadKey {
  id: string;
  organization_id: string;
  company_id: string;
  share_group_id: string | null;
  created_by_user_id: string;
  status: string;
}

async function addMessage(tx: Sql, thread: ThreadKey, userId: string, fromStaff: boolean, body: string): Promise<string> {
  const rows = await tx.query<{ id: string }>(
    "insert into er_contact_messages (organization_id, thread_id, author_user_id, from_staff, body) values ($1,$2,$3,$4,$5) returning id",
    [thread.organization_id, thread.id, userId, fromStaff, body],
  );
  await tx.query("select er_notify_contact_message($1)", [rows[0].id]);
  return rows[0].id;
}

/** Tarkistaa liitteet ennen kuin mitään tallennetaan (tyyppi, koko, määrä). */
export async function checkContactFiles(files: File[]) {
  if (files.length > MAX_CONTACT_ATTACHMENTS) throw new ContactError(`Voit lisätä enintään ${MAX_CONTACT_ATTACHMENTS} liitettä kerralla.`);
  try {
    return await prepareAttachments(files);
  } catch (err) {
    throw new ContactError(err instanceof Error ? err.message : "Liitettä ei voitu lukea.");
  }
}

async function saveAttachments(tx: Sql, files: File[], thread: ThreadKey, userId: string): Promise<number> {
  if (files.length === 0) return 0;
  const prepared = await checkContactFiles(files);
  for (const p of prepared) {
    const stored = await storeFile({ organizationId: thread.organization_id, companyId: thread.company_id, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes });
    await tx.query(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
          visibility, subject_table, subject_id, uploaded_by)
       values ($1,$2,$3,$4,'Yhteydenoton liite',$5,$6,$7,$8,$9,'internal','er_contact_threads',$10,$11)`,
      [thread.organization_id, thread.company_id, thread.share_group_id, p.mimeType.startsWith("image/") ? "photo" : "other",
        stored.fileName, stored.storagePath, stored.mimeType, stored.sizeBytes, stored.sha256, thread.id, userId],
    );
  }
  return prepared.length;
}

async function loadThread(tx: Sql, threadId: string): Promise<ThreadKey> {
  const [t] = await tx.query<ThreadKey>(
    "select id, organization_id, company_id, share_group_id, created_by_user_id, status from er_contact_threads where id = $1",
    [threadId],
  );
  if (!t) throw new ContactError("Yhteydenottoa ei löytynyt.");
  return t;
}

export interface NewThread {
  userId: string;
  companyId: string;
  shareGroupId: string | null;
  topic: ContactTopic;
  subject: string;
  body: string;
  files?: File[];
}

/** Portaalikäyttäjän uusi yhteydenotto. */
export async function createThread(tx: Sql, n: NewThread): Promise<string> {
  const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [n.companyId]);
  if (!company) throw new ContactError("Taloyhtiötä ei löytynyt.");
  const [thread] = await tx.query<ThreadKey>(
    `insert into er_contact_threads (organization_id, company_id, share_group_id, created_by_user_id, topic, subject)
     values ($1,$2,$3,$4,$5,$6) returning id, organization_id, company_id, share_group_id, created_by_user_id, status`,
    [company.organization_id, n.companyId, n.shareGroupId, n.userId, n.topic, n.subject],
  );
  await addMessage(tx, thread, n.userId, false, n.body);
  await saveAttachments(tx, n.files ?? [], thread, n.userId);
  await audit(tx, { organizationId: thread.organization_id, userId: n.userId, action: "create", entity: "contact_thread", entityId: thread.id, details: { topic: n.topic } });
  return thread.id;
}

/** Viesti ketjuun. Portaalista vain ketjun aloittaja; henkilökunnan vastaus `fromStaff`-lipulla. */
export async function postMessage(tx: Sql, opts: { threadId: string; userId: string; fromStaff: boolean; body: string; files?: File[] }): Promise<string> {
  const thread = await loadThread(tx, opts.threadId);
  if (!opts.fromStaff && thread.created_by_user_id !== opts.userId) throw new ContactError("Voit kirjoittaa vain omaan yhteydenottoosi.");
  const id = await addMessage(tx, thread, opts.userId, opts.fromStaff, opts.body);
  await saveAttachments(tx, opts.files ?? [], thread, opts.userId);
  if (opts.fromStaff) {
    await audit(tx, { organizationId: thread.organization_id, userId: opts.userId, action: "reply", entity: "contact_thread", entityId: thread.id });
  }
  return id;
}

/** Henkilökunta merkitsee käsitellyksi tai avaa uudelleen. */
export async function setThreadClosed(tx: Sql, opts: { threadId: string; userId: string; closed: boolean }): Promise<void> {
  const thread = await loadThread(tx, opts.threadId);
  if ((thread.status === "closed") === opts.closed) return;
  const rows = opts.closed
    ? await tx.query("update er_contact_threads set status = 'closed', closed_at = now(), closed_by = $2 where id = $1 returning id", [thread.id, opts.userId])
    : await tx.query(
        `update er_contact_threads set closed_at = null, closed_by = null,
                status = case when coalesce((select m.from_staff from er_contact_messages m where m.thread_id = $1 order by m.created_at desc limit 1), false)
                              then 'answered' else 'open' end
          where id = $1 returning id`,
        [thread.id],
      );
  if (rows.length === 0) throw new ContactError("Roolillasi ei voi muuttaa yhteydenoton tilaa.");
  await audit(tx, { organizationId: thread.organization_id, userId: opts.userId, action: opts.closed ? "close" : "reopen", entity: "contact_thread", entityId: thread.id });
}
