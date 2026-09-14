import type { Database, Sql } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Portaalikäyttäjän oma profiili.
 *
 * Nimi ja puhelin päivitetään käyttäjän RLS-transaktiossa (user_self_update).
 *
 * Sähköisen kokouskutsun suostumus on rekisterin osapuolirivillä
 * (er_parties.electronic_notice_consent), johon portaalikäyttäjällä ei ole
 * kirjoitusoikeutta, eikä sitä anneta: muuten hän voisi muuttaa myös nimeä,
 * osoitetta tai käyttäjäliitosta. Siksi päivitys tehdään palvelun roolilla
 * kyselyllä, joka
 *  - koskee vain rivejä, joiden user_id on istunnon käyttäjä,
 *  - muuttaa vain yhtä saraketta,
 *  - kirjataan audit-lokiin osapuolen organisaatioon.
 */

export async function updateOwnProfile(db: Database, user: { sub: string }, input: { fullName: string | null; phone: string | null }): Promise<void> {
  await db.asUser(user.sub, (tx) =>
    tx.query("update er_users set full_name = $1, phone = $2 where id = er_current_user_id()", [input.fullName, input.phone]),
  );
}

export interface OwnPartyRow {
  id: string;
  organization_id: string;
  display_name: string;
  electronic_notice_consent: boolean;
  companies: string | null;
}

/** Käyttäjän omat osapuolirivit (RLS portal_self_party). */
export async function listOwnParties(tx: Sql): Promise<OwnPartyRow[]> {
  return tx.query<OwnPartyRow>(
    `select p.id, p.organization_id, p.display_name, p.electronic_notice_consent,
            (select string_agg(distinct c.name, ', ') from er_portal_access a join er_housing_companies c on c.id = a.company_id
              where a.user_id = p.user_id and a.organization_id = p.organization_id
                and (a.ends_on is null or a.ends_on >= current_date)) as companies
       from er_parties p
      where p.user_id = er_current_user_id()
      order by p.display_name`,
  );
}

/** Palvelun roolilla, rajattu käyttäjän omiin riveihin. Palauttaa päivitettyjen rivien määrän. */
export async function setOwnNoticeConsent(db: Database, user: { id: string }, partyId: string, consent: boolean): Promise<number> {
  return db.asService(async (tx) => {
    const rows = await tx.query<{ id: string; organization_id: string }>(
      `update er_parties set electronic_notice_consent = $3
        where id = $1 and user_id = $2 and electronic_notice_consent is distinct from $3
        returning id, organization_id`,
      [partyId, user.id, consent],
    );
    for (const r of rows) {
      await audit(tx, { organizationId: r.organization_id, userId: user.id, action: consent ? "consent_given" : "consent_withdrawn", entity: "party_notice_consent", entityId: r.id });
    }
    return rows.length;
  });
}
