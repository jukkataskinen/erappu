import { z } from "zod";
import { emptyToNull as emptyString } from "@/lib/forms";
import { CATEGORIES, COST_RESPONSIBILITIES, STATUSES, URGENCIES } from "./labels";

/** Lomakkeiden zod-skeemat. Kaikki syötteet tarkistetaan palvelimella. */

export const uuid = z.string().uuid();
/** Tyhjä tai puuttuva kenttä → null. */
const emptyToNull = (v: unknown) => (v === undefined ? null : emptyString(v));
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const optText = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable());
const optUuid = z.preprocess(emptyToNull, uuid.nullable());
const optDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Päivämäärä ei ole kelvollinen.").nullable());
const optEmail = z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(254).nullable());
const optPhone = z.preprocess(
  emptyToNull,
  z.string().max(40).regex(/^[+0-9 ()-]{5,40}$/, "Puhelinnumero ei ole kelvollinen.").nullable(),
);
export const optEur = z.preprocess(
  (v) => (typeof v === "string" ? emptyToNull(v.replace(/\s/g, "").replace(",", ".")) : v),
  z.coerce.number().min(0, "Summa ei voi olla negatiivinen.").max(10_000_000).nullable(),
);

const description = z.string().max(5000, "Kuvaus on liian pitkä.");
const category = z.enum(CATEGORIES, { message: "Valitse aihe." });
const urgency = z.enum(URGENCIES).default("normal");

export const staffRequestSchema = z.object({
  company_id: uuid,
  share_group_id: optUuid,
  unit_text: optText(60),
  title: z.string().min(2, "Anna lyhyt otsikko.").max(200),
  description,
  category,
  urgency,
  may_use_master_key: checkbox,
  has_pets: checkbox,
  reporter_name: optText(200),
  reporter_phone: optPhone,
  reporter_email: optEmail,
  assignee_user_id: optUuid,
  due_on: optDate,
});

export const portalRequestSchema = z.object({
  target: z.string().regex(/^[0-9a-f-]{36}(\|[0-9a-f-]{36})?$/i, "Valitse yhtiö ja huoneisto."),
  category,
  description: description.min(5, "Kuvaile vika muutamalla sanalla."),
  urgency,
  may_use_master_key: checkbox,
  has_pets: checkbox,
  reporter_phone: optPhone,
});

export const publicRequestSchema = z.object({
  token: z.string().min(20).max(100),
  reporter_name: z.string().min(2, "Anna nimesi.").max(200),
  reporter_phone: optPhone,
  reporter_email: optEmail,
  unit_text: z.string().min(1, "Kerro huoneisto tai tila.").max(60),
  category,
  description: description.min(5, "Kuvaile vika muutamalla sanalla."),
  // Roskapostiansa: ihminen ei näe kenttää.
  website: z.string().max(0).optional().default(""),
});

export const statusSchema = z.object({
  id: uuid,
  status: z.enum(STATUSES),
  comment: optText(5000),
  visibility: z.enum(["internal", "reporter", "provider", "board"]).default("internal"),
});

export const assignmentSchema = z.object({
  id: uuid,
  assignee_user_id: optUuid,
  provider_id: optUuid,
  due_on: optDate,
  urgency,
  category,
  share_group_id: optUuid,
});

export const costSchema = z.object({
  id: uuid,
  cost_responsibility: z.enum(COST_RESPONSIBILITIES),
  cost_eur: optEur,
});

export const commentSchema = z.object({
  id: uuid,
  body: z.string().min(1, "Kirjoita kommentti.").max(5000),
  visibility: z.enum(["internal", "reporter", "provider", "board"]).default("internal"),
});

export const providerSchema = z.object({
  name: z.string().min(2, "Anna nimi.").max(200),
  business_id: optText(20),
  email: optEmail,
  phone: optPhone,
  emergency_phone: optPhone,
  trades: z.string().max(500).default(""),
  notes: optText(2000),
});

export const companyServiceSchema = z.object({
  provider_id: uuid,
  company_id: uuid,
  service: z.string().min(2, "Anna palvelun nimi.").max(100),
  default_for_requests: checkbox,
});

export function splitTrades(value: string): string[] {
  return [...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

/** Portaalin otsikko kuvauksen alusta, jottei ilmoittajan tarvitse keksiä otsikkoa. */
export function titleFromDescription(text: string, fallback: string): string {
  const firstLine = text.split(/\r?\n/)[0].trim();
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}...` : firstLine;
}
