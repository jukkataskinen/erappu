import type { Database } from "@/lib/db/types";
import { syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { createUser, one, type Fixture } from "../helpers/db";

/**
 * Demon As Oy Esimerkkirinne organisaatioon A (sama kuin scripts/seed-demo.mts),
 * jotta mock-HTJ:n erot ovat ennustettavat: A 3 myyty, A 4 jaettu puoliksi.
 */
export interface RinneFixture {
  groups: Record<string, string>;
  parties: Record<string, string>;
  ownerships: Record<string, string>;
  users: { chair: { id: string; sub: string }; owner: { id: string; sub: string }; veera: { id: string; sub: string } };
}

export async function seedRinne(db: Database, f: Fixture): Promise<RinneFixture> {
  const chair = await createUser(db);
  const owner = await createUser(db);
  const veera = await createUser(db);
  return db.asService(async (tx) => {
    await tx.query("update er_housing_companies set business_id = '1000000-9', name = 'As Oy Esimerkkirinne', total_shares = 500 where id = $1", [f.companyA]);
    const units: [string, number, number, number][] = [["A 1", 1, 143, 143], ["A 2", 144, 241, 98], ["A 3", 242, 339, 98], ["A 4", 340, 500, 111]];
    const groups: Record<string, string> = {};
    for (const [label, first, last, area] of units) {
      const g = await one<{ id: string }>(tx,
        "insert into er_share_groups (organization_id, company_id, unit_label, kind, area_m2, layout, intended_use, source) values ($1,$2,$3,'apartment',$4,$5,'Asuinhuoneisto','manual') returning id",
        [f.orgA, f.companyA, label, area, label === "A 1" ? "4h+k+s" : "3h+k+s"]);
      groups[label] = g.id;
      await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)", [f.orgA, f.companyA, g.id, first, last]);
    }
    const people: [string, string, string, string | null][] = [
      ["A 1", "Paula", "Puheenjohtaja", chair.id],
      ["A 2", "Olli", "Osakas", owner.id],
      ["A 3", "Veera", "Vuokranantaja", veera.id],
      ["A 4", "Matti", "Meikäläinen", null],
    ];
    const parties: Record<string, string> = {};
    const ownerships: Record<string, string> = {};
    for (const [unit, first, last, uid] of people) {
      const p = await one<{ id: string }>(tx,
        "insert into er_parties (organization_id, first_names, last_name, email, user_id) values ($1,$2,$3,$4,$5) returning id",
        [f.orgA, first, last, `${first.toLowerCase()}@example.test`, uid]);
      parties[unit] = p.id;
      const o = await one<{ id: string }>(tx,
        "insert into er_ownerships (organization_id, share_group_id, party_id, starts_on, source) values ($1,$2,$3,'2016-05-01','manual') returning id",
        [f.orgA, groups[unit], p.id]);
      ownerships[unit] = o.id;
      await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'owner','2016-05-01')", [f.orgA, groups[unit], p.id]);
    }
    await tx.query("insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2026-01-01')", [f.orgA, f.companyA, parties["A 1"]]);
    await tx.query("insert into er_portal_access (organization_id, user_id, company_id, role, basis) values ($1,$2,$3,'board',$4)", [f.orgA, chair.id, f.companyA, `board:test`]);
    for (const gid of Object.values(groups)) await syncPortalAccessForGroup(tx, gid);
    return { groups, parties, ownerships, users: { chair, owner, veera } };
  });
}
