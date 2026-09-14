import { openLocalDb } from "./lib/local-db.mts";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "../src/lib/registry/portal-access.ts";

/**
 * Kuvitteellinen esimerkkidata kehitykseen ja esittelyyn. Kaikki nimet,
 * osoitteet ja tunnukset ovat keksittyjä (Y-tunnukset tarkistemerkiltään
 * kelvollisia mutta eivät oikeiden yhtiöiden). Idempotentti: ajaa uudelleen
 * vain, jos demo-organisaatiota ei ole.
 */
const db = await openLocalDb();

await db.asService(async (tx) => {
  const [existing] = await tx.query<{ id: string }>("select id from er_organizations where business_id = '0000001-9'");
  if (existing) {
    console.log("Demodata on jo kannassa.");
    return;
  }

  const user = async (sub: string, email: string, name: string) =>
    (await tx.query<{ id: string }>("insert into er_users (auth_sub, email, full_name) values ($1,$2,$3) returning id", [sub, email, name]))[0].id;

  const [org] = await tx.query<{ id: string }>("insert into er_organizations (name, business_id) values ('Demo Isännöinti Oy', '0000001-9') returning id");
  const manager = await user("dev|isannoitsija", "iida.isannoitsija@example.test", "Iida Isännöitsijä");
  const acc1 = await user("dev|kirjanpitaja1", "kalle.kirjanpitaja@example.test", "Kalle Kirjanpitäjä");
  const acc2 = await user("dev|kirjanpitaja2", "kaisa.kirjanpitaja@example.test", "Kaisa Kirjanpitäjä");
  const chairUser = await user("dev|puheenjohtaja", "paula.puheenjohtaja@example.test", "Paula Puheenjohtaja");
  const ownerUser = await user("dev|osakas", "olli.osakas@example.test", "Olli Osakas");
  const tenantUser = await user("dev|asukas", "anna.asukas@example.test", "Anna Asukas");
  await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'accountant'),($1,$4,'accountant')", [org.id, manager, acc1, acc2]);

  const company = async (name: string, businessId: string, address: string, shares: number) =>
    (
      await tx.query<{ id: string }>(
        `insert into er_housing_companies (organization_id, name, business_id, street_address, postal_code, city, total_shares, manager_user_id,
           management_started_on, same_charge_basis, insurance_company, insurance_type, property_maintenance, articles_date)
         values ($1,$2,$3,$4,'41660','Toivakka',$5,$6,'2015-01-01',true,'Esimerkkivakuutus','Täysarvovakuutus','Huoltoliike','2008-08-08') returning id`,
        [org.id, name, businessId, address, shares, manager],
      )
    )[0].id;

  const rinne = await company("As Oy Esimerkkirinne", "1000000-9", "Rinnetie 4", 500);
  const pihla = await company("As Oy Pihlajakuja", "2000000-5", "Pihlajakuja 2", 794);

  await tx.query(
    `insert into er_buildings (organization_id, company_id, label, building_type, completed_year, floors, apartment_area_m2, construction_material, roof_type, roof_material, heating, ventilation, common_spaces)
     values ($1,$2,'A','Rivitalo',2008,1,450,'Puu/tiili','Harjakatto','Peltikate','Maalämpö','Koneellinen tulo/poisto','{sauna,ulkoiluvälinevarasto}'),
            ($1,$3,'A','Rivitalo',1979,1,794,'Tiili','Harjakatto','Tiilikate','Kaukolämpö','Koneellinen poisto','{sauna}')`,
    [org.id, rinne, pihla],
  );
  await tx.query(
    `insert into er_properties (organization_id, company_id, property_code, tenure, area_m2, parking_spaces_planned, parking_spaces_built)
     values ($1,$2,'850-405-5-900','own',3442,4,4), ($1,$3,'850-405-5-901','own',4671,10,10)`,
    [org.id, rinne, pihla],
  );

  const units: { company: string; label: string; area: number; layout: string; first: number; last: number }[] = [
    { company: rinne, label: "A 1", area: 143, layout: "4h+k+s", first: 1, last: 143 },
    { company: rinne, label: "A 2", area: 98, layout: "3h+k+s", first: 144, last: 241 },
    { company: rinne, label: "A 3", area: 98, layout: "3h+k+s", first: 242, last: 339 },
    { company: rinne, label: "A 4", area: 111, layout: "3h+k+s", first: 340, last: 500 },
  ];
  for (let i = 0; i < 10; i++) {
    units.push({ company: pihla, label: `A ${i + 1}`, area: i % 2 ? 79.4 : 79.4, layout: i % 3 === 0 ? "3h+k+s" : "2h+k+s", first: i * 79 + 1 + Math.min(i, 4), last: (i + 1) * 79 + Math.min(i + 1, 4) });
  }

  const groupIds: Record<string, string> = {};
  for (const u of units) {
    const [g] = await tx.query<{ id: string }>(
      "insert into er_share_groups (organization_id, company_id, unit_label, kind, layout, area_m2, intended_use, source) values ($1,$2,$3,'apartment',$4,$5,'Asuinhuoneisto','manual') returning id",
      [org.id, u.company, u.label, u.layout, u.area],
    );
    groupIds[`${u.company}:${u.label}`] = g.id;
    await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)", [org.id, u.company, g.id, u.first, u.last]);
  }

  const party = async (first: string, last: string, email: string | null, userId: string | null = null) =>
    (
      await tx.query<{ id: string }>(
        "insert into er_parties (organization_id, first_names, last_name, email, street_address, postal_code, city, user_id) values ($1,$2,$3,$4,'Rinnetie 4','41660','Toivakka',$5) returning id",
        [org.id, first, last, email, userId],
      )
    )[0].id;

  const owners = [
    ["Paula", "Puheenjohtaja", "paula.puheenjohtaja@example.test", chairUser, `${rinne}:A 1`],
    ["Olli", "Osakas", "olli.osakas@example.test", ownerUser, `${rinne}:A 2`],
    ["Veera", "Vuokranantaja", "veera.vuokranantaja@example.test", null, `${rinne}:A 3`],
    ["Matti", "Meikäläinen", null, null, `${rinne}:A 4`],
  ] as const;
  const partyIds: string[] = [];
  for (const [first, last, email, uid, key] of owners) {
    const pid = await party(first, last, email, uid);
    partyIds.push(pid);
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, starts_on, source) values ($1,$2,$3,'2016-05-01','manual')", [org.id, groupIds[key], pid]);
    if (key !== `${rinne}:A 3`) await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'owner','2016-05-01')", [org.id, groupIds[key], pid]);
  }
  const tenant = await party("Anna", "Asukas", "anna.asukas@example.test", tenantUser);
  await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'tenant','2024-09-01')", [org.id, groupIds[`${rinne}:A 3`], tenant]);
  await tx.query("update er_share_groups set is_rented = true where id = $1", [groupIds[`${rinne}:A 3`]]);

  for (let i = 0; i < 10; i++) {
    const pid = await party(["Aino", "Eero", "Helmi", "Juho", "Kerttu", "Lauri", "Mirja", "Niko", "Oona", "Pekka"][i], "Esimerkki", `osakas${i + 1}@example.test`);
    await tx.query("insert into er_ownerships (organization_id, share_group_id, party_id, starts_on, source) values ($1,$2,$3,'2010-01-01','manual')", [org.id, groupIds[`${pihla}:A ${i + 1}`], pid]);
  }

  await tx.query(
    "insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on) values ($1,$2,$3,'chair','2026-04-15'),($1,$2,$4,'member','2026-04-15')",
    [org.id, rinne, partyIds[0], partyIds[1]],
  );

  const [provider] = await tx.query<{ id: string }>(
    "insert into er_service_providers (organization_id, name, business_id, email, phone, emergency_phone, trades) values ($1,'Esimerkkihuolto Oy','3000000-1','huolto@example.test','040 000 0001','040 000 0002','{kiinteistöhuolto,lvi,sähkö}') returning id",
    [org.id],
  );
  await tx.query(
    "insert into er_company_services (organization_id, company_id, provider_id, service, default_for_requests) values ($1,$2,$4,'kiinteistöhuolto',true),($1,$3,$4,'kiinteistöhuolto',true)",
    [org.id, rinne, pihla, provider.id],
  );

  await tx.query(
    `insert into er_charge_bases (organization_id, company_id, charge_type, basis, unit_price, starts_on, decided_on, htj_charge_type)
     values ($1,$2,'maintenance','area_m2',3.00,'2025-07-01','2025-04-20','hoitovastike'),
            ($1,$3,'maintenance','area_m2',2.30,'2023-07-01','2023-04-18','hoitovastike')`,
    [org.id, rinne, pihla],
  );
  const [loan] = await tx.query<{ id: string }>(
    "insert into er_loans (organization_id, company_id, name, lender, principal_eur, drawn_on, due_on, interest_terms, balance_eur, balance_date) values ($1,$2,'Kattoremonttilaina 2023','Esimerkkipankki',120000,'2023-10-31','2038-10-31','12 kk euribor + 0,85 %',96000,'2025-12-31') returning id",
    [org.id, rinne],
  );
  for (const u of units.filter((x) => x.company === rinne)) {
    const share = Math.round((120000 * (u.last - u.first + 1)) / 500);
    await tx.query("insert into er_loan_shares (organization_id, loan_id, share_group_id, original_eur, remaining_eur, balance_date) values ($1,$2,$3,$4,$5,'2025-12-31')", [
      org.id, loan.id, groupIds[`${rinne}:${u.label}`], share, Math.round(share * 0.8),
    ]);
  }
  await tx.query(
    `insert into er_maintenance_works (organization_id, company_id, project, work_type, completed_year, cost_eur, description)
     values ($1,$2,'Vesikaton uusiminen','Vesikatto',2024,118500,'Peltikate ja aluskate uusittu, räystäät ja syöksytorvet'),
            ($1,$3,'Putkiremontti','Käyttövesi- ja viemäriputket',2019,640000,'Sukitus ja käyttövesiputkien uusiminen')`,
    [org.id, rinne, pihla],
  );
  await tx.query(
    `insert into er_maintenance_needs (organization_id, company_id, planned_year, target, action, work_type, estimate_eur, affects_residents)
     values ($1,$2,2027,'Julkisivut','Ulkomaalaus','Julkisivu',28000,false),
            ($1,$2,2029,'Ilmanvaihto','IV-koneiden uusiminen','Ilmanvaihto',45000,true)`,
    [org.id, rinne],
  );

  for (const id of Object.values(groupIds)) await syncPortalAccessForGroup(tx, id);
  await syncPortalAccessForBoard(tx, rinne);
  console.log("Demodata luotu: Demo Isännöinti Oy, 2 taloyhtiötä, 14 huoneistoa, 6 käyttäjää.");
});

await db.close();
