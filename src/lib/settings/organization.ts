import { z } from "zod";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emptyToNull as emptyStringToNull } from "@/lib/forms";
import { isValidBusinessId, isValidPostalCode, normalizeBusinessId } from "@/lib/validation/finnish";

/**
 * Organisaation perustiedot ja asetukset.
 *
 * Yhteystiedot ja todistusten oletushinnat ovat `er_organizations.settings`
 * -jsonb:ssä avaimen `contact` ja `certificate_prices` alla. Päivitys
 * yhdistää (`||`) eikä korvaa koko kenttää, jotta muiden moduulien avaimet
 * säilyvät.
 */

export interface OrganizationSettings {
  contact?: {
    phone?: string | null;
    email?: string | null;
    street_address?: string | null;
    postal_code?: string | null;
    city?: string | null;
  };
  /** Isännöitsijäntodistuksen oletushinnat euroina (sis. alv). M5 lukee nämä. */
  certificate_prices?: {
    standard_eur?: number | null;
    express_eur?: number | null;
  };
}

export interface OrganizationRow {
  id: string;
  name: string;
  business_id: string | null;
  settings: OrganizationSettings;
}

/** Puuttuva tai tyhjä kenttä → null. */
const emptyToNull = (v: unknown) => (v === undefined ? null : emptyStringToNull(v));

const optText = z.preprocess(emptyToNull, z.string().max(200).nullable());
const optPrice = z.preprocess(
  (v) => (typeof v === "string" ? emptyToNull(v.replace(",", ".").replace(/\s|€/g, "")) : emptyToNull(v)),
  z.coerce.number().min(0, "Hinta ei voi olla negatiivinen.").max(10000, "Tarkista hinta.").nullable(),
);

export const organizationSchema = z.object({
  name: z.string().min(2, "Anna organisaation nimi.").max(200),
  business_id: z.preprocess(
    emptyToNull,
    z.string().transform(normalizeBusinessId).refine(isValidBusinessId, "Y-tunnus ei ole kelvollinen.").nullable(),
  ),
  phone: optText,
  email: z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200).nullable()),
  street_address: optText,
  postal_code: z.preprocess(emptyToNull, z.string().refine(isValidPostalCode, "Postinumerossa on 5 numeroa.").nullable()),
  city: optText,
  certificate_standard_eur: optPrice,
  certificate_express_eur: optPrice,
});

export type OrganizationInput = z.infer<typeof organizationSchema>;

export async function getOrganization(tx: Sql, organizationId: string): Promise<OrganizationRow | null> {
  const [row] = await tx.query<OrganizationRow>("select id, name, business_id, settings from er_organizations where id = $1", [organizationId]);
  return row ?? null;
}

/** Aja käyttäjän RLS-transaktiossa (org_owner_update: vain pääkäyttäjä). Palauttaa false, jos rivi ei päivittynyt. */
export async function updateOrganization(tx: Sql, organizationId: string, actorId: string, input: OrganizationInput): Promise<boolean> {
  const patch: OrganizationSettings = {
    contact: { phone: input.phone, email: input.email, street_address: input.street_address, postal_code: input.postal_code, city: input.city },
    certificate_prices: { standard_eur: input.certificate_standard_eur, express_eur: input.certificate_express_eur },
  };
  const rows = await tx.query(
    "update er_organizations set name = $2, business_id = $3, settings = settings || $4::jsonb where id = $1 returning id",
    [organizationId, input.name, input.business_id, JSON.stringify(patch)],
  );
  if (rows.length === 0) return false;
  await audit(tx, { organizationId, userId: actorId, action: "update", entity: "organization", entityId: organizationId });
  return true;
}
