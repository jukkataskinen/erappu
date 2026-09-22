import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { defaultReminderOn } from "@/lib/contracts/deadlines";
import { assertRealEsinetti, buildExternalRef, createRoundOnce, isEsinettiError, type EsinettiClient } from "@/lib/esinetti";
import { ensureEsinettiCompany } from "@/lib/signing/company";
import { isoDateHelsinki } from "@/lib/format";
import { deleteStoredFile, readStoredFile, storeFile, type StoredFile } from "@/lib/storage";
import { getTemplate } from "./index";
import { renderContractPdf } from "./pdf";
import { getBatch, listBatchItems, type BatchItemRow, type BatchRow } from "./queries";
import {
  addYears,
  chooseRepresentative,
  defaultValues,
  fillTemplate,
  mergeValues,
  nextSeasonTitle,
  normalizeValues,
  prefillFromRegistry,
  validateValues,
  type RegistryContext,
} from "./render";
import type { ContractTemplate, TemplateValues } from "./types";

/**
 * Sopimusten massaluonti: erä → yhtiöt ja yhtiökohtaiset arvot → muodostus
 * (PDF + er_contracts) → lähetys eSinettiin → webhook (`signing.ts`).
 *
 * Tiedot luetaan ja kirjoitetaan käyttäjän RLS-transaktiossa (`run`), joten
 * toisen organisaation erä tai yhtiö ei näy eikä sitä voi kirjoittaa. PDF:t
 * renderöidään ja tallennetaan transaktion ulkopuolella; jos kantakirjoitus
 * epäonnistuu, tallennetut tiedostot poistetaan.
 */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface Actor {
  userId: string;
  organizationId: string;
  /** Pääkäyttäjä tai isännöitsijä: lähetys, peruminen ja muodostettujen asiakirjojen poisto. */
  canManage: boolean;
}

export interface BatchDeps {
  store?: (opts: Parameters<typeof storeFile>[0]) => Promise<StoredFile>;
  remove?: (storagePath: string) => Promise<void>;
  read?: (storagePath: string) => Promise<Buffer>;
  today?: string;
}

/** Käyttäjälle näytettävä virhe. `details` on lista puuttuvista tiedoista. */
export class BatchError extends Error {
  constructor(message: string, public readonly details: string[] = []) {
    super(message);
  }
}

const EDITABLE: BatchRow["status"][] = ["draft", "generated"];

function requireTemplate(key: string): ContractTemplate {
  const template = getTemplate(key);
  if (!template) throw new BatchError("Sopimuspohjaa ei löytynyt.");
  return template;
}

async function loadBatch(tx: Sql, batchId: string): Promise<BatchRow> {
  const batch = await getBatch(tx, batchId);
  if (!batch) throw new BatchError("Erää ei löytynyt.");
  return batch;
}

async function loadProvider(tx: Sql, organizationId: string, providerId: string | null) {
  if (!providerId) return null;
  const [p] = await tx.query<{ id: string; name: string; business_id: string | null; email: string | null }>(
    "select id, name, business_id, email from er_service_providers where id = $1 and organization_id = $2",
    [providerId, organizationId],
  );
  if (!p) throw new BatchError("Urakoitsijaa ei löytynyt palveluntuottajarekisteristä.");
  return p;
}

/** Yhtiön tiedot ja tilaajan edustaja rekisteristä. */
export async function loadCompanyContext(tx: Sql, companyId: string): Promise<Omit<RegistryContext, "provider"> | null> {
  const [company] = await tx.query<RegistryContext["company"] & { manager_name: string | null; manager_email: string | null }>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, coalesce(u.full_name, u.email) as manager_name, coalesce(u.contact_email, u.email) as manager_email
       from er_housing_companies c left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [companyId],
  );
  if (!company) return null;
  const [chair] = await tx.query<{ name: string; email: string | null }>(
    `select p.display_name as name, p.email
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role = 'chair' and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
      order by b.starts_on desc limit 1`,
    [companyId],
  );
  return {
    company: { name: company.name, business_id: company.business_id, street_address: company.street_address, postal_code: company.postal_code, city: company.city },
    representative: chooseRepresentative(chair ?? null, { name: company.manager_name, email: company.manager_email }),
  };
}

async function prefillCompany(tx: Sql, template: ContractTemplate, companyId: string, today: string): Promise<TemplateValues> {
  const ctx = await loadCompanyContext(tx, companyId);
  if (!ctx) throw new BatchError("Yhtiötä ei löytynyt.");
  return { ...defaultValues(template, "company", today), ...prefillFromRegistry(template, "company", { ...ctx, provider: null }) };
}

/** Täyttää tyhjät urakoitsijakentät rekisteristä. */
function fillProviderDefaults(template: ContractTemplate, shared: TemplateValues, provider: Awaited<ReturnType<typeof loadProvider>>): TemplateValues {
  if (!provider) return shared;
  const fromRegistry = prefillFromRegistry(template, "batch", {
    company: { name: "", business_id: "", street_address: null, postal_code: null, city: null },
    representative: null,
    provider,
  });
  const out = { ...shared };
  for (const [key, value] of Object.entries(fromRegistry)) {
    if (out[key] === null || out[key] === undefined || out[key] === "") out[key] = value;
  }
  return out;
}

async function activeCompanyIds(tx: Sql, organizationId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.query<{ id: string }>(
    "select id from er_housing_companies where organization_id = $1 and id = any($2::uuid[]) and management_ended_on is null",
    [organizationId, ids],
  );
  return rows.map((r) => r.id);
}

function formatErrors(errors: { message: string }[]): string[] {
  return errors.map((e) => e.message.charAt(0).toUpperCase() + e.message.slice(1));
}

// ---------------------------------------------------------------------------
// 1–3: luonti ja muokkaus

export interface CreateBatchInput {
  templateKey: string;
  title: string;
  providerId: string | null;
  sharedRaw: Record<string, unknown>;
  companyIds: string[];
}

export async function createBatch(run: Runner, actor: Actor, input: CreateBatchInput, deps: BatchDeps = {}): Promise<string> {
  const template = requireTemplate(input.templateKey);
  const today = deps.today ?? isoDateHelsinki();
  const { values, errors } = normalizeValues(template, input.sharedRaw, "batch");
  if (errors.length) throw new BatchError("Tarkista yhteiset tiedot.", formatErrors(errors));

  return run(async (tx) => {
    const provider = await loadProvider(tx, actor.organizationId, input.providerId);
    const shared = fillProviderDefaults(template, { ...defaultValues(template, "batch", today), ...values, provider_id: provider?.id ?? null }, provider);
    const [batch] = await tx.query<{ id: string }>(
      `insert into er_contract_batches (organization_id, template_key, template_version, title, provider_id, shared_values, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [actor.organizationId, template.key, template.version, input.title, provider?.id ?? null, JSON.stringify(shared), actor.userId],
    );
    const companies = await activeCompanyIds(tx, actor.organizationId, input.companyIds);
    for (const companyId of companies) {
      await tx.query(
        `insert into er_contract_batch_items (organization_id, batch_id, company_id, "values") values ($1,$2,$3,$4)`,
        [actor.organizationId, batch.id, companyId, JSON.stringify(await prefillCompany(tx, template, companyId, today))],
      );
    }
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "create", entity: "contract_batch", entityId: batch.id, details: { template: template.key, companies: companies.length } });
    return batch.id;
  });
}

/** Palauttaa muodostetut rivit luonnokseksi: arvot muuttuivat, PDF on vanhentunut. */
async function markStale(tx: Sql, batchId: string) {
  await tx.query("update er_contract_batch_items set status = 'draft' where batch_id = $1 and status = 'generated'", [batchId]);
  await tx.query("update er_contract_batches set status = 'draft' where id = $1 and status = 'generated'", [batchId]);
}

export async function updateBatchDetails(run: Runner, actor: Actor, batchId: string, input: { title: string; providerId: string | null; sharedRaw: Record<string, unknown> }): Promise<void> {
  await run(async (tx) => {
    const batch = await loadBatch(tx, batchId);
    if (!EDITABLE.includes(batch.status)) throw new BatchError("Lähetetyn erän tietoja ei voi muuttaa.");
    const template = requireTemplate(batch.template_key);
    const { values, errors } = normalizeValues(template, input.sharedRaw, "batch");
    if (errors.length) throw new BatchError("Tarkista yhteiset tiedot.", formatErrors(errors));
    const provider = await loadProvider(tx, batch.organization_id, input.providerId);
    const shared = fillProviderDefaults(template, { ...batch.shared_values, ...values, provider_id: provider?.id ?? null }, provider);
    await tx.query("update er_contract_batches set title = $2, provider_id = $3, shared_values = $4 where id = $1", [batchId, input.title, provider?.id ?? null, JSON.stringify(shared)]);
    await markStale(tx, batchId);
    await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "update", entity: "contract_batch", entityId: batchId });
  });
}

/** Lisää ja poistaa yhtiöitä. Muodostetun rivin poisto poistaa myös sen sopimuksen ja PDF:n. */
export async function setBatchCompanies(run: Runner, actor: Actor, batchId: string, companyIds: string[], deps: BatchDeps = {}): Promise<void> {
  const remove = deps.remove ?? deleteStoredFile;
  const today = deps.today ?? isoDateHelsinki();
  const removedFiles = await run(async (tx) => {
    const batch = await loadBatch(tx, batchId);
    if (!EDITABLE.includes(batch.status)) throw new BatchError("Yhtiöitä voi muuttaa vain ennen lähetystä.");
    const template = requireTemplate(batch.template_key);
    const items = await listBatchItems(tx, batchId);
    const wanted = new Set(await activeCompanyIds(tx, batch.organization_id, companyIds));
    const files: string[] = [];
    for (const item of items.filter((i) => !wanted.has(i.company_id))) {
      if ((item.document_id || item.contract_id) && !actor.canManage) throw new BatchError("Muodostetun sopimuksen poistaminen vaatii pääkäyttäjän tai isännöitsijän oikeudet.");
      files.push(...(await discardGenerated(tx, item)));
      await tx.query("delete from er_contract_batch_items where id = $1", [item.id]);
    }
    const existing = new Set(items.map((i) => i.company_id));
    for (const companyId of wanted) {
      if (existing.has(companyId)) continue;
      await tx.query(
        `insert into er_contract_batch_items (organization_id, batch_id, company_id, "values") values ($1,$2,$3,$4)`,
        [batch.organization_id, batchId, companyId, JSON.stringify(await prefillCompany(tx, template, companyId, today))],
      );
      await tx.query("update er_contract_batches set status = 'draft' where id = $1 and status = 'generated'", [batchId]);
    }
    await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "set_companies", entity: "contract_batch", entityId: batchId, details: { companies: wanted.size } });
    return files;
  });
  for (const path of removedFiles) await remove(path);
}

/** Poistaa rivin muodostetun sopimuksen ja PDF:n. Palauttaa poistettavat tiedostopolut. */
async function discardGenerated(tx: Sql, item: Pick<BatchItemRow, "id" | "contract_id" | "document_id">): Promise<string[]> {
  const files: string[] = [];
  await tx.query("update er_contract_batch_items set contract_id = null, document_id = null where id = $1", [item.id]);
  if (item.contract_id) await tx.query("delete from er_contracts where id = $1", [item.contract_id]);
  if (item.document_id) {
    const rows = await tx.query<{ storage_path: string }>("delete from er_documents where id = $1 and not sealed returning storage_path", [item.document_id]);
    files.push(...rows.map((r) => r.storage_path));
  }
  return files;
}

/**
 * Tallentaa yhtiökohtaiset arvot yhdellä lomakkeella. `raw` on
 * `{ [companyId]: { [kenttä]: arvo } }`. Tyhjä ylikirjoitus = yhteinen arvo.
 */
export async function updateBatchItems(run: Runner, actor: Actor, batchId: string, raw: Record<string, Record<string, unknown>>): Promise<void> {
  await run(async (tx) => {
    const batch = await loadBatch(tx, batchId);
    if (!EDITABLE.includes(batch.status)) throw new BatchError("Lähetetyn erän tietoja ei voi muuttaa.");
    const template = requireTemplate(batch.template_key);
    const items = await listBatchItems(tx, batchId);
    const problems: string[] = [];
    let changed = 0;
    for (const item of items) {
      const input = raw[item.company_id];
      if (!input) continue;
      const { values, errors } = normalizeValues(template, input, "company");
      if (errors.length) {
        problems.push(...errors.map((e) => `${item.company_name}: ${e.message}`));
        continue;
      }
      const next = { ...item.values, ...values };
      if (JSON.stringify(next) === JSON.stringify(item.values)) continue;
      changed++;
      await tx.query(
        `update er_contract_batch_items set "values" = $2, status = case when status = 'generated' then 'draft' else status end where id = $1`,
        [item.id, JSON.stringify(next)],
      );
    }
    if (problems.length) throw new BatchError("Tarkista yhtiökohtaiset tiedot.", problems);
    if (changed > 0) {
      await tx.query("update er_contract_batches set status = 'draft' where id = $1 and status = 'generated'", [batchId]);
      await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "update_items", entity: "contract_batch", entityId: batchId, details: { changed } });
    }
  });
}

// ---------------------------------------------------------------------------
// 4: muodostus

export interface ItemContext {
  item: BatchItemRow;
  values: TemplateValues;
}

/** Yhteiset ja yhtiökohtaiset arvot sekä rekisterin nimet paikkamerkkeihin. */
export function effectiveValues(template: ContractTemplate, batch: BatchRow, item: BatchItemRow): TemplateValues {
  return {
    ...mergeValues(template, { ...batch.shared_values, provider_id: batch.provider_id }, item.values),
    company_name: item.company_name,
    company_business_id: item.company_business_id,
    provider_name: batch.provider_name,
    provider_business_id: batch.provider_business_id,
    batch_title: batch.title,
  };
}

/** Kaikkien rivien tarkistus. Palauttaa käyttäjälle näytettävät virheet. */
export function validateBatch(template: ContractTemplate, batch: BatchRow, items: BatchItemRow[], today: string): string[] {
  const messages = new Set<string>();
  const byKey = new Map(template.fields.map((f) => [f.key, f]));
  for (const item of items) {
    for (const e of validateValues(template, effectiveValues(template, batch, item), { today })) {
      const field = byKey.get(e.key);
      // Yhteisen kentän virhe näytetään kerran, ellei yhtiöllä ole omaa arvoa.
      const shared = field?.scope === "batch" && !(field.overridable && item.values[e.key]);
      messages.add(`${shared ? "Yhteiset tiedot" : item.company_name}: ${e.message}`);
    }
  }
  return [...messages];
}

export async function generateBatch(run: Runner, actor: Actor, batchId: string, deps: BatchDeps = {}): Promise<number> {
  const store = deps.store ?? storeFile;
  const remove = deps.remove ?? deleteStoredFile;
  const today = deps.today ?? isoDateHelsinki();

  const loaded = await run(async (tx) => {
    const batch = await loadBatch(tx, batchId);
    const items = await listBatchItems(tx, batchId);
    const [org] = await tx.query<{ name: string }>("select name from er_organizations where id = $1", [batch.organization_id]);
    return { batch, items, organizationName: org?.name ?? "" };
  });
  const { batch, organizationName } = loaded;
  if (!EDITABLE.includes(batch.status)) throw new BatchError("Lähetetyn erän sopimuksia ei voi muodostaa uudelleen.");
  const template = requireTemplate(batch.template_key);
  const items = loaded.items.filter((i) => i.status === "draft" || i.status === "generated");
  if (items.length === 0) throw new BatchError("Valitse erään vähintään yksi yhtiö.");
  if (!actor.canManage && items.some((i) => i.document_id)) {
    throw new BatchError("Sopimusten muodostaminen uudelleen vaatii pääkäyttäjän tai isännöitsijän oikeudet.");
  }

  // Ei osittaista tilaa: jos yksikin rivi on puutteellinen, mitään ei muodosteta.
  const errors = validateBatch(template, batch, items, today);
  if (errors.length) throw new BatchError("Sopimuksia ei muodostettu, koska tietoja puuttuu.", errors);

  const rendered: { item: BatchItemRow; values: TemplateValues; stored: StoredFile; title: string; description: string }[] = [];
  try {
    for (const item of items) {
      const values = effectiveValues(template, batch, item);
      const filled = fillTemplate(template, values);
      const pdf = await renderContractPdf({
        contract: filled,
        organizationName,
        companyName: item.company_name,
        companyBusinessId: item.company_business_id,
        issuedOn: today,
      });
      const stored = await store({
        organizationId: batch.organization_id,
        companyId: item.company_id,
        fileName: `${template.key === "snow-ploughing" ? "lumityosopimus" : "sopimus"}-${String(values[template.endsOnField ?? ""] ?? today)}.pdf`,
        mimeType: "application/pdf",
        bytes: Buffer.from(pdf.bytes),
      });
      rendered.push({ item, values, stored, title: filled.documentTitle, description: filled.contractDescription });
    }
  } catch (err) {
    for (const r of rendered) await remove(r.stored.storagePath);
    throw err;
  }

  let oldFiles: string[];
  try {
    oldFiles = await run(async (tx) => {
      const files: string[] = [];
      for (const r of rendered) {
        const endsOn = template.endsOnField ? (r.values[template.endsOnField] as string | null) : null;
        const [doc] = await tx.query<{ id: string }>(
          `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
                                     visibility, year, subject_table, subject_id, uploaded_by)
           values ($1,$2,'contract',$3,$4,$5,$6,$7,$8,'board',$9,'er_contract_batch_items',$10,$11) returning id`,
          [batch.organization_id, r.item.company_id, r.title.slice(0, 300), r.stored.fileName, r.stored.storagePath, r.stored.mimeType, r.stored.sizeBytes,
            r.stored.sha256, Number(today.slice(0, 4)), r.item.id, actor.userId],
        );
        const contractValues = [batch.provider_name, template.category, r.description.slice(0, 4000), today, endsOn, template.noticeMonths, doc.id, defaultReminderOn(endsOn, template.noticeMonths)];
        let contractId = r.item.contract_id;
        if (contractId) {
          const updated = await tx.query(
            `update er_contracts set counterparty = $2, category = $3, description = $4, starts_on = $5, ends_on = $6, notice_months = $7,
                    document_id = $8, reminder_on = $9, reminded_at = null, status = 'active'
              where id = $1 returning id`,
            [contractId, ...contractValues],
          );
          if (updated.length === 0) contractId = null;
        }
        if (!contractId) {
          const [contract] = await tx.query<{ id: string }>(
            `insert into er_contracts (counterparty, category, description, starts_on, ends_on, notice_months, document_id, reminder_on, organization_id, company_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
            [...contractValues, batch.organization_id, r.item.company_id, actor.userId],
          );
          contractId = contract.id;
        }
        await tx.query("update er_contract_batch_items set status = 'generated', error = null, contract_id = $2, document_id = $3 where id = $1", [r.item.id, contractId, doc.id]);
        if (r.item.document_id) {
          const rows = await tx.query<{ storage_path: string }>("delete from er_documents where id = $1 and not sealed returning storage_path", [r.item.document_id]);
          files.push(...rows.map((x) => x.storage_path));
        }
      }
      await tx.query("update er_contract_batches set status = 'generated' where id = $1", [batchId]);
      await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "generate_contracts", entity: "contract_batch", entityId: batchId, details: { count: rendered.length } });
      return files;
    });
  } catch (err) {
    for (const r of rendered) await remove(r.stored.storagePath);
    throw err;
  }
  for (const path of oldFiles) await remove(path);
  return rendered.length;
}

// ---------------------------------------------------------------------------
// 5: lähetys allekirjoitettavaksi

export interface SendResult {
  sent: number;
  failed: { companyName: string; error: string }[];
}

const SENDABLE: BatchItemRow["status"][] = ["generated", "error", "declined"];

export async function sendBatch(run: Runner, actor: Actor, batchId: string, client: EsinettiClient, opts: { itemIds?: string[] } = {}, deps: BatchDeps = {}): Promise<SendResult> {
  if (!actor.canManage) throw new BatchError("Sopimukset lähettää allekirjoitettavaksi pääkäyttäjä tai isännöitsijä.");
  assertRealEsinetti();
  const read = deps.read ?? readStoredFile;

  const { batch, items, requester } = await run(async (tx) => {
    const b = await loadBatch(tx, batchId);
    const list = await listBatchItems(tx, batchId);
    const paths = await tx.query<{ id: string; storage_path: string }>(
      "select d.id, d.storage_path from er_documents d where d.id = any($1::uuid[])",
      [list.map((i) => i.document_id).filter(Boolean)],
    );
    const pathById = new Map(paths.map((p) => [p.id, p.storage_path]));
    // Pyytäjä eSinetin viesteihin: lähettäjä ja isännöintitoimisto ("Nimi (Adepta) kutsui sinut…").
    const [requester] = await tx.query<{ name: string | null; org_name: string }>(
      "select u.full_name as name, o.name as org_name from er_organizations o left join er_users u on u.id = $2 where o.id = $1",
      [actor.organizationId, actor.userId],
    );
    return { batch: b, items: list.map((i) => ({ ...i, storage_path: i.document_id ? pathById.get(i.document_id) ?? null : null })), requester };
  });
  if (batch.status !== "generated" && batch.status !== "sent") throw new BatchError("Muodosta sopimukset ennen lähetystä.");
  const template = requireTemplate(batch.template_key);
  const selected = items.filter((i) => SENDABLE.includes(i.status) && i.contract_id && i.storage_path && (!opts.itemIds || opts.itemIds.includes(i.id)));
  if (selected.length === 0) throw new BatchError("Ei lähetettäviä sopimuksia.");

  const result: SendResult = { sent: 0, failed: [] };
  const markError = async (item: BatchItemRow, message: string) => {
    result.failed.push({ companyName: item.company_name, error: message });
    await run((tx) => tx.query("update er_contract_batch_items set status = 'error', error = $2 where id = $1", [item.id, message.slice(0, 500)]));
  };

  for (const item of selected) {
    const values = effectiveValues(template, batch, item);
    const filled = fillTemplate(template, values);
    const signers = filled.signers.filter((s) => s.name && s.email);
    if (signers.length !== filled.signers.length) {
      await markError(item, "Allekirjoittajan nimi tai sähköposti puuttuu.");
      continue;
    }
    let round;
    try {
      const bytes = await read(item.storage_path!);
      round = await createRoundOnce(client, {
        companyId: await ensureEsinettiCompany(run, client, item.company_id),
        title: `${item.company_name}: ${filled.documentTitle}`,
        documents: [{ name: `${template.key === "snow-ploughing" ? "lumityosopimus" : "sopimus"}.pdf`, pdfBytes: new Uint8Array(bytes) }],
        signers: signers.map((s) => ({ name: s.name, email: s.email, roleLabel: s.roleLabel, authLevel: "strong" })),
        externalRef: buildExternalRef("contract", item.id),
        requestedBy: requester ? { name: requester.name ?? undefined, organization: requester.org_name } : undefined,
        expiresInDays: 30,
        send: true,
      });
    } catch (err) {
      // Yksi epäonnistuminen ei pysäytä muita yhtiöitä.
      await markError(item, isEsinettiError(err) ? err.message : "Allekirjoituskierroksen luonti epäonnistui.");
      continue;
    }
    try {
      await run(async (tx) => {
        const state = signers.map((s) => {
          const remote = round.signers.find((r) => r.email.toLowerCase() === s.email.toLowerCase());
          return { name: s.name, email: s.email, role: s.roleLabel, status: remote?.status ?? "pending", signedAt: remote?.signedAt ?? null };
        });
        const [row] = await tx.query<{ id: string }>(
          `insert into er_signing_rounds (organization_id, company_id, subject_table, subject_id, esinetti_round_id, status, signers, original_document_id, last_event, created_by)
           values ($1,$2,'er_contract_batch_items',$3,$4,$5,$6,$7,'created',$8) returning id`,
          [batch.organization_id, item.company_id, item.id, round.id, round.status, JSON.stringify(state), item.document_id, actor.userId],
        );
        await tx.query("update er_contract_batch_items set status = 'sent', error = null, signing_round_id = $2 where id = $1", [item.id, row.id]);
        await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "send_for_signing", entity: "contract_batch_item", entityId: item.id, details: { roundId: row.id, batchId } });
      });
      result.sent++;
    } catch {
      // Kierros jäisi eSinettiin ilman vastinetta: perutaan, jotta kukaan ei allekirjoita turhaan.
      await client.cancelRound(round.id).catch(() => undefined);
      await markError(item, "Lähetyksen tallennus epäonnistui. Yritä uudelleen.");
    }
  }

  if (result.sent > 0) {
    await run((tx) => tx.query("update er_contract_batches set status = 'sent' where id = $1 and status in ('generated', 'sent')", [batchId]));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Peruminen

export async function cancelBatch(run: Runner, actor: Actor, batchId: string, client: EsinettiClient, deps: BatchDeps = {}): Promise<void> {
  if (!actor.canManage) throw new BatchError("Erän perumiseen tarvitaan pääkäyttäjän tai isännöitsijän oikeudet.");
  const remove = deps.remove ?? deleteStoredFile;
  const { batch, items, rounds } = await run(async (tx) => {
    const b = await loadBatch(tx, batchId);
    const list = await listBatchItems(tx, batchId);
    const r = await tx.query<{ id: string; esinetti_round_id: string | null }>(
      "select id, esinetti_round_id from er_signing_rounds where subject_table = 'er_contract_batch_items' and subject_id = any($1::uuid[]) and status in ('draft','sent','partially_signed')",
      [list.map((i) => i.id)],
    );
    return { batch: b, items: list, rounds: r };
  });
  if (batch.status === "cancelled" || batch.status === "completed") throw new BatchError("Erä on jo päättynyt.");
  for (const r of rounds) if (r.esinetti_round_id) await client.cancelRound(r.esinetti_round_id).catch(() => undefined);

  const files = await run(async (tx) => {
    const out: string[] = [];
    if (rounds.length) await tx.query("update er_signing_rounds set status = 'cancelled', last_event = 'cancelled_by_user' where id = any($1::uuid[])", [rounds.map((r) => r.id)]);
    for (const item of items.filter((i) => i.status !== "signed")) {
      out.push(...(await discardGenerated(tx, item)));
      await tx.query("update er_contract_batch_items set status = 'cancelled' where id = $1", [item.id]);
    }
    await tx.query("update er_contract_batches set status = 'cancelled' where id = $1", [batchId]);
    await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "cancel", entity: "contract_batch", entityId: batchId });
    return out;
  });
  for (const path of files) await remove(path);
}

// ---------------------------------------------------------------------------
// 7: seuraavan kauden erä

export async function renewBatch(run: Runner, actor: Actor, batchId: string, deps: BatchDeps = {}): Promise<string> {
  const today = deps.today ?? isoDateHelsinki();
  return run(async (tx) => {
    const batch = await loadBatch(tx, batchId);
    const template = requireTemplate(batch.template_key);
    const items = await listBatchItems(tx, batchId);
    const shared: TemplateValues = { ...batch.shared_values };
    for (const f of template.fields) {
      if (f.scope === "batch" && f.type === "date" && typeof shared[f.key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(shared[f.key] as string)) {
        shared[f.key] = addYears(shared[f.key] as string, 1);
      }
    }
    const [created] = await tx.query<{ id: string }>(
      `insert into er_contract_batches (organization_id, template_key, template_version, title, provider_id, shared_values, previous_batch_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [batch.organization_id, template.key, template.version, nextSeasonTitle(batch.title).slice(0, 200), batch.provider_id, JSON.stringify(shared), batchId, actor.userId],
    );
    const active = new Set(await activeCompanyIds(tx, batch.organization_id, items.map((i) => i.company_id)));
    for (const item of items) {
      if (!active.has(item.company_id)) continue;
      // Hallitus on voinut vaihtua: edustaja haetaan rekisteristä uudelleen, muut arvot kopioidaan.
      const fresh = await prefillCompany(tx, template, item.company_id, today);
      const values: TemplateValues = { ...item.values };
      for (const f of template.fields) {
        if (f.source?.startsWith("representative.") && fresh[f.key]) values[f.key] = fresh[f.key];
      }
      await tx.query(
        `insert into er_contract_batch_items (organization_id, batch_id, company_id, "values") values ($1,$2,$3,$4)`,
        [batch.organization_id, created.id, item.company_id, JSON.stringify(values)],
      );
    }
    await audit(tx, { organizationId: batch.organization_id, userId: actor.userId, action: "renew", entity: "contract_batch", entityId: created.id, details: { previous: batchId } });
    return created.id;
  });
}
