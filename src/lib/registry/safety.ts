import { z } from "zod";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { SHELTER_OPTIONS, type RescuePlanContent, type ShelterOption } from "@/lib/rescue-plans/content";

/**
 * Yhtiön turvallisuustiedot rekisterissä (0108): väestönsuoja,
 * kokoontumispaikat ja pääsulkujen sijainnit. Pelastussuunnitelma
 * esitäyttää niistä vastaavat kentät.
 */

export interface SafetyInfo {
  shelter: ShelterOption | null;
  shelter_location: string | null;
  shelter_capacity: string | null;
  assembly_point: string | null;
  assembly_point_alt: string | null;
  shutoff_water: string | null;
  shutoff_electricity: string | null;
  shutoff_ventilation: string | null;
  shutoff_heating: string | null;
}

export const SAFETY_COLUMNS = [
  "shelter", "shelter_location", "shelter_capacity", "assembly_point", "assembly_point_alt",
  "shutoff_water", "shutoff_electricity", "shutoff_ventilation", "shutoff_heating",
] as const satisfies readonly (keyof SafetyInfo)[];

const opt = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(max, "Teksti on liian pitkä.").nullable());

export const safetySchema = z.object({
  shelter: z.preprocess((v) => (v === "" ? null : v), z.enum(SHELTER_OPTIONS).nullable()),
  shelter_location: opt(300),
  shelter_capacity: opt(40),
  assembly_point: opt(300),
  assembly_point_alt: opt(300),
  shutoff_water: opt(300),
  shutoff_electricity: opt(300),
  shutoff_ventilation: opt(300),
  shutoff_heating: opt(300),
});

export async function loadSafetyInfo(tx: Sql, companyId: string): Promise<SafetyInfo | null> {
  const [row] = await tx.query<SafetyInfo>(`select ${SAFETY_COLUMNS.join(", ")} from er_housing_companies where id = $1`, [companyId]);
  return row ?? null;
}

export async function saveSafetyInfo(tx: Sql, opts: { companyId: string; userId: string; info: SafetyInfo }): Promise<boolean> {
  const sets = SAFETY_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const rows = await tx.query<{ organization_id: string }>(`update er_housing_companies set ${sets} where id = $1 returning organization_id`, [
    opts.companyId,
    ...SAFETY_COLUMNS.map((c) => opts.info[c]),
  ]);
  if (rows.length === 0) return false;
  await audit(tx, { organizationId: rows[0].organization_id, userId: opts.userId, action: "update", entity: "housing_company", entityId: opts.companyId, details: { safety: true } });
  return true;
}

/**
 * Pelastussuunnitelman kentät rekisteristä. Vain täytetyt tiedot: tyhjä
 * rekisterikenttä ei pyyhi suunnitelmaan käsin kirjoitettua tekstiä.
 */
export function safetyPlanFields(info: SafetyInfo | null): Partial<RescuePlanContent> {
  if (!info) return {};
  const out: Partial<RescuePlanContent> = {};
  if (info.shelter) out.shelter = info.shelter;
  if (info.shelter_location) out.shelterLocation = info.shelter_location;
  if (info.shelter_capacity) out.shelterCapacity = info.shelter_capacity;
  if (info.assembly_point) out.assemblyPoint = info.assembly_point;
  if (info.assembly_point_alt) out.assemblyPointAlt = info.assembly_point_alt;
  if (info.shutoff_water) out.shutoffWater = info.shutoff_water;
  if (info.shutoff_electricity) out.shutoffElectricity = info.shutoff_electricity;
  if (info.shutoff_ventilation) out.shutoffVentilation = info.shutoff_ventilation;
  if (info.shutoff_heating) out.shutoffHeating = info.shutoff_heating;
  return out;
}
