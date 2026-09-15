import { z } from "zod";
import { CONTEXT_KEYS, type ContractTemplate, type FieldDef, type FieldValue, type TemplateValues } from "./types";

/**
 * Pohjan täyttö ja arvojen tarkistus. Puhdasta logiikkaa ilman kantaa, jotta
 * sama tarkistus toimii lomakkeella, muodostuksessa ja yksikkötesteissä.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Suomalainen rahasyöte ("1 200,5") → "1200.50". */
function normalizeMoney(v: unknown): unknown {
  if (typeof v === "number") return v.toFixed(2);
  if (typeof v !== "string") return v;
  const cleaned = v.replace(/[\s €]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return v;
  return Number(cleaned).toFixed(2);
}

function normalizeBoolean(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (["true", "kyllä", "kylla", "on", "1"].includes(s)) return true;
  if (["false", "ei", "off", "0"].includes(s)) return false;
  return v;
}

/** Yhden kentän zod-skeema (ilman pakollisuutta: tyhjä → null). */
export function fieldSchema(field: FieldDef): z.ZodType<FieldValue> {
  const nullable = <T extends z.ZodType<FieldValue>>(schema: T) => z.preprocess((v) => (empty(v) ? null : v), schema.nullable()) as unknown as z.ZodType<FieldValue>;
  switch (field.type) {
    case "text":
      return nullable(z.string().trim().max(200));
    case "textarea":
      return nullable(z.string().trim().max(4000));
    case "email":
      return nullable(z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email().max(254)) as unknown as z.ZodType<string>);
    case "date":
      return nullable(z.string().refine(isRealDate));
    case "money":
      return nullable(z.preprocess(normalizeMoney, z.string().regex(/^\d{1,9}\.\d{2}$/)) as unknown as z.ZodType<string>);
    case "integer":
      return nullable(z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().regex(/^-?\d{1,9}$/)) as unknown as z.ZodType<string>);
    case "boolean":
      return nullable(z.preprocess(normalizeBoolean, z.boolean()) as unknown as z.ZodType<boolean>);
    case "provider":
      return nullable(z.uuid());
  }
}

/** Pohjan kenttien skeema. `scope` rajaa yhteisiin tai yhtiökohtaisiin kenttiin. */
export function buildValuesSchema(template: ContractTemplate, scope?: "batch" | "company") {
  const shape: Record<string, z.ZodType<FieldValue>> = {};
  for (const f of template.fields) {
    if (scope && f.scope !== scope) continue;
    const base = fieldSchema(f);
    shape[f.key] = f.required ? base.refine((v) => v !== null, { message: "required" }) : base;
  }
  return z.object(shape);
}

export interface FieldError {
  key: string;
  label: string;
  message: string;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Genetiivimuoto virheviestiin ("Tilaajan edustajan sähköposti puuttuu" käy sellaisenaan). */
function missingMessage(field: FieldDef): string {
  return `${lowerFirst(field.label)} puuttuu`;
}

/**
 * Normalisoi annetut arvot kenttätyypin mukaan. Tuntemattomat avaimet
 * pudotetaan, jotta lomakkeelta ei voi tallentaa ylimääräistä jsonb:hen.
 * Pakollisuutta ei tarkisteta: luonnos saa olla keskeneräinen.
 */
export function normalizeValues(template: ContractTemplate, raw: Record<string, unknown>, scope: "batch" | "company"): { values: TemplateValues; errors: FieldError[] } {
  const values: TemplateValues = {};
  const errors: FieldError[] = [];
  for (const f of template.fields) {
    const allowed = f.scope === scope || (scope === "company" && f.overridable);
    if (!allowed || !(f.key in raw)) continue;
    const parsed = fieldSchema(f).safeParse(raw[f.key]);
    if (parsed.success) values[f.key] = parsed.data;
    else errors.push({ key: f.key, label: f.label, message: `${lowerFirst(f.label)}: tarkista arvo` });
  }
  return { values, errors };
}

/** Yhteiset arvot + yhtiökohtaiset. Yhtiön ylikirjoitus voittaa, jos se on annettu. */
export function mergeValues(template: ContractTemplate, shared: TemplateValues, company: TemplateValues): TemplateValues {
  const out: TemplateValues = {};
  for (const f of template.fields) {
    const own = company[f.key];
    const common = shared[f.key];
    if (f.scope === "company") out[f.key] = own ?? null;
    else out[f.key] = f.overridable && !empty(own) ? (own as FieldValue) : (common ?? null);
  }
  return out;
}

/** Tarkistaa täytetyt arvot: muoto ja pakollisuus. */
export function validateValues(template: ContractTemplate, values: TemplateValues, opts: { today?: string } = {}): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of template.fields) {
    const parsed = fieldSchema(f).safeParse(values[f.key] ?? null);
    if (!parsed.success) {
      errors.push({ key: f.key, label: f.label, message: `${lowerFirst(f.label)}: tarkista arvo` });
      continue;
    }
    if (f.required && parsed.data === null) {
      errors.push({ key: f.key, label: f.label, message: missingMessage(f) });
      continue;
    }
    // Päättymispäivä ei voi olla menneisyydessä: sopimus tulee voimaan allekirjoituksesta.
    if (opts.today && f.key === template.endsOnField && typeof parsed.data === "string" && parsed.data < opts.today) {
      errors.push({ key: f.key, label: f.label, message: `${lowerFirst(f.label)} on menneisyydessä` });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Täyttö

export interface FilledSection {
  number: number;
  heading: string;
  keyValues: { label: string; value: string }[];
  paragraphs: string[];
}

export interface FilledContract {
  templateKey: string;
  templateVersion: number;
  title: string;
  documentTitle: string;
  contractDescription: string;
  approved: boolean;
  sections: FilledSection[];
  signatories: { role: string; name: string }[];
  signers: { roleLabel: string; name: string; email: string }[];
}

function formatDateFi(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

/** "1 200,00". Tavallinen välilyönti, koska PDF-fontissa kapea välilyönti on eri glyyfi. */
export function formatMoneyFi(value: string): string {
  const [int, dec = "00"] = Number(value).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec}`;
}

export function formatFieldValue(field: FieldDef | undefined, value: FieldValue | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "kyllä" : "ei";
  if (!field) return value;
  if (field.type === "date" && isRealDate(value)) return formatDateFi(value);
  if (field.type === "money" && /^\d+(\.\d+)?$/.test(value)) return formatMoneyFi(value);
  if (field.type === "boolean") return normalizeBoolean(value) === true ? "kyllä" : "ei";
  return value;
}

export class TemplateFillError extends Error {}

/**
 * Korvaa paikkamerkit `{{kentta}}` muotoilluilla arvoilla. Tuntematon
 * paikkamerkki on ohjelmointivirhe pohjassa, joten se kaatuu eikä jää
 * näkymään valmiiseen sopimukseen.
 */
export function fillText(template: ContractTemplate, text: string, values: TemplateValues): string {
  const byKey = new Map(template.fields.map((f) => [f.key, f]));
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const field = byKey.get(key);
    if (!field && !(CONTEXT_KEYS as readonly string[]).includes(key)) throw new TemplateFillError(`Pohjassa tuntematon kenttä: ${key}`);
    return formatFieldValue(field, values[key]);
  });
}

export function fillTemplate(template: ContractTemplate, values: TemplateValues): FilledContract {
  const fill = (text: string) => fillText(template, text, values);
  return {
    templateKey: template.key,
    templateVersion: template.version,
    title: template.title,
    documentTitle: fill(template.documentTitle),
    contractDescription: fill(template.contractDescription),
    approved: template.approved,
    sections: template.sections.map((s, i) => ({
      number: i + 1,
      heading: s.heading,
      keyValues: (s.keyValues ?? []).map((kv) => ({ label: kv.label, value: fill(kv.value) })),
      paragraphs: (s.paragraphs ?? []).map(fill),
    })),
    signatories: template.signatureRoles.map((r) => ({ role: r.role, name: fill(r.name) })),
    signers: template.signers.map((s) => ({ roleLabel: s.roleLabel, name: fill(s.name), email: fill(s.email) })),
  };
}

/** Pohjan oletusarvot (ilman rekisteristä esitäytettäviä). */
export function defaultValues(template: ContractTemplate, scope: "batch" | "company", today: string): TemplateValues {
  const out: TemplateValues = {};
  for (const f of template.fields) {
    if (f.scope !== scope || f.default === undefined) continue;
    out[f.key] = typeof f.default === "function" ? f.default(today) : f.default;
  }
  return out;
}

export interface RegistryContext {
  company: { name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null };
  representative: { name: string; email: string | null } | null;
  provider: { name: string; business_id: string | null; email: string | null } | null;
}

/** Katuosoite + postinumero ja -toimipaikka: "Rinnetie 4, 41660 Toivakka". */
export function companyAddress(c: RegistryContext["company"]): string | null {
  const city = [c.postal_code, c.city].filter(Boolean).join(" ");
  return [c.street_address, city].filter(Boolean).join(", ") || null;
}

/**
 * Tilaajan edustaja: voimassa oleva hallituksen puheenjohtaja, jolla on nimi.
 * Jos puheenjohtajaa ei ole, vastuuisännöitsijä (isännöitsijä edustaa yhtiötä
 * juoksevissa asioissa, AOYL 7:15 §).
 */
export function chooseRepresentative(
  chair: { name: string; email: string | null } | null,
  manager: { name: string | null; email: string | null } | null,
): { name: string; email: string | null } | null {
  if (chair?.name) return { name: chair.name, email: chair.email };
  if (manager?.name || manager?.email) return { name: manager.name ?? manager.email ?? "", email: manager.email };
  return null;
}

/** Esitäyttää kentät, joilla on rekisterilähde. */
export function prefillFromRegistry(template: ContractTemplate, scope: "batch" | "company", ctx: RegistryContext): TemplateValues {
  const out: TemplateValues = {};
  for (const f of template.fields) {
    if (f.scope !== scope || !f.source) continue;
    const v: Record<string, string | null | undefined> = {
      "company.name": ctx.company.name,
      "company.business_id": ctx.company.business_id,
      "company.address": companyAddress(ctx.company),
      "representative.name": ctx.representative?.name,
      "representative.email": ctx.representative?.email,
      "provider.name": ctx.provider?.name,
      "provider.business_id": ctx.provider?.business_id,
      "provider.email": ctx.provider?.email,
    };
    out[f.key] = v[f.source] ?? null;
  }
  return out;
}

/** VVVV-KK-PP + n vuotta; karkauspäivä siirtyy 28.2:een. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = y + years;
  const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${target}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Lumityösopimukset 2026–2027" → "Lumityösopimukset 2027–2028". */
export function nextSeasonTitle(title: string): string {
  const next = title.replace(/\b(19|20)\d{2}\b/g, (y) => String(Number(y) + 1));
  return next === title ? `${title} (seuraava kausi)` : next;
}
