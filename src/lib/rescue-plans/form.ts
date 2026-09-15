import { z } from "zod";
import { contentSchema, HAZARD_TEMPLATES, SHELTER_OPTIONS, type PlanBuilding, type PlanHazard, type RescuePlanContent } from "./content";

/**
 * Lomakkeen ja sisällön muunnos. Lomake on litteä (FormData), sisältö
 * rakenteinen: rakennukset `b{i}_*`, vaaratilanteet `h{i}_*`, liitteet
 * `att_{uuid}`. Puhdas funktio, jotta muunnos on testattavissa.
 */

export const TEXT_FIELDS = [
  "preparedBy", "preparationNote", "updateProcedure", "boardApprovedOn",
  "companyName", "address", "propertyCodes", "apartments", "residentsEstimate", "commercialUnits", "heating", "fireplaces", "commonSpaces",
  "storages", "parking", "keySystem", "hazardousMaterials", "unusualUse",
  "managerName", "managerPhone", "managerEmail", "chairName", "chairPhone", "safetyPersons", "maintenanceName", "maintenancePhone",
  "maintenanceEmergencyPhone", "otherContacts",
  "riskConclusions",
  "smokeAlarms", "extinguishers", "escapeRoutes", "assemblyPoint", "assemblyPointAlt", "rescueRoad", "shutoffWater", "shutoffElectricity",
  "shutoffVentilation", "shutoffHeating", "storageRules", "hotWork", "inspections",
  "extraInstructions",
  "shelterLocation", "shelterCapacity", "shelterResponsible", "shelterNotes",
  "communication", "training",
  "attachmentNotes",
] as const satisfies readonly (keyof RescuePlanContent)[];

const BUILDING_FIELDS = ["label", "type", "completedYear", "floors", "material", "heating", "ventilation"] as const satisfies readonly (keyof PlanBuilding)[];

/** Lomakkeella näytettävät vaaratilanteet: tallennetut ja pohjan uudet (valitsematta). */
export function hazardsForForm(content: RescuePlanContent): PlanHazard[] {
  const keys = new Set(content.hazards.map((h) => h.key));
  const missing = HAZARD_TEMPLATES.filter((t) => !keys.has(t.key)).map((t) => ({ ...t, selected: false, custom: false }));
  return [...content.hazards, ...missing];
}

const count = (v: string | undefined, max: number) => Math.max(0, Math.min(max, Number.parseInt(v ?? "0", 10) || 0));

export class PlanFormError extends Error {}

export function contentFromForm(form: Record<string, string>, attachmentIds: string[]): RescuePlanContent {
  const raw: Record<string, unknown> = {};
  for (const key of TEXT_FIELDS) raw[key] = form[key] ?? "";

  const buildings: PlanBuilding[] = [];
  for (let i = 0; i < count(form.building_count, 30); i++) {
    const b = Object.fromEntries(BUILDING_FIELDS.map((f) => [f, form[`b${i}_${f}`] ?? ""])) as PlanBuilding;
    if (form[`b${i}_remove`] === "on") continue;
    if (BUILDING_FIELDS.some((f) => b[f].trim())) buildings.push(b);
  }
  raw.buildings = buildings;

  const hazards: PlanHazard[] = [];
  const used = new Set<string>();
  let customIndex = 0;
  for (let i = 0; i < count(form.hazard_count, 40); i++) {
    const title = (form[`h${i}_title`] ?? "").trim();
    if (!title) continue;
    let key = (form[`h${i}_key`] ?? "").trim();
    const custom = form[`h${i}_custom`] === "1" || !key;
    if (!/^[a-z0-9_]{1,40}$/.test(key) || used.has(key)) {
      do key = `custom_${++customIndex}`;
      while (used.has(key));
    }
    used.add(key);
    const level = Number.parseInt(form[`h${i}_level`] ?? "2", 10);
    hazards.push({
      key,
      title,
      selected: form[`h${i}_selected`] === "on",
      consequence: form[`h${i}_consequence`] ?? "",
      level: level >= 1 && level <= 5 ? level : 2,
      prevention: form[`h${i}_prevention`] ?? "",
      custom,
    });
  }
  raw.hazards = hazards;
  raw.shelter = (SHELTER_OPTIONS as readonly string[]).includes(form.shelter ?? "") ? form.shelter : "unknown";
  raw.attachmentDocumentIds = attachmentIds.filter((id) => form[`att_${id}`] === "on");
  if (raw.boardApprovedOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.boardApprovedOn))) raw.boardApprovedOn = "";

  const parsed = contentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PlanFormError(issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "Tarkista lomakkeen tiedot.");
  }
  return parsed.data;
}

export const planMetaSchema = z.object({
  prepared_on: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista laatimispäivä.").nullable()),
  next_review_on: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista seuraavan tarkistuksen päivä.").nullable()),
  visibility: z.enum(["residents", "owners", "board", "internal"]),
});
