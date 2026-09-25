import type { Sql } from "@/lib/db";

/**
 * Kirjeen lähettäjä: taloyhtiö isännöintiyrityksen osoitteessa. Osoite on
 * palautusosoite, joten se on isännöintitoimiston eikä yhtiön osoite
 * (organisaation asetukset, `settings.contact`).
 */
export interface LetterSender {
  companyName: string;
  organizationName: string;
  /** null, jos isännöintiyrityksen postiosoite puuttuu asetuksista. */
  lines: string[] | null;
  manager: { name: string | null; email: string | null; phone: string | null };
}

export const MISSING_SENDER_ADDRESS = "Lisää isännöintiyrityksen postiosoite asetuksiin (Asetukset, organisaatio). Se tulee kirjeen palautusosoitteeksi.";

export async function loadLetterSender(tx: Sql, companyId: string): Promise<LetterSender | null> {
  const [row] = await tx.query<{
    company_name: string; org_name: string; street: string | null; postal_code: string | null; city: string | null;
    manager_name: string | null; manager_email: string | null; manager_phone: string | null;
  }>(
    `select c.name as company_name, o.name as org_name,
            o.settings #>> '{contact,street_address}' as street, o.settings #>> '{contact,postal_code}' as postal_code, o.settings #>> '{contact,city}' as city,
            coalesce(u.full_name, u.email) as manager_name, coalesce(u.contact_email, u.email) as manager_email, u.phone as manager_phone
       from er_housing_companies c join er_organizations o on o.id = c.organization_id left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [companyId],
  );
  if (!row) return null;
  const street = row.street?.trim();
  const postalCode = row.postal_code?.trim();
  const city = row.city?.trim();
  return {
    companyName: row.company_name,
    organizationName: row.org_name,
    lines: street && postalCode && city ? [row.company_name, `c/o ${row.org_name}`, street, `${postalCode} ${city}`] : null,
    manager: { name: row.manager_name, email: row.manager_email, phone: row.manager_phone },
  };
}
