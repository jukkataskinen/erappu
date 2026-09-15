import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openLocalDb } from "./lib/local-db.mts";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "../src/lib/registry/portal-access.ts";
import { makePdf, makePng } from "../tests/helpers/pdf-fixtures.ts";
import type { Sql } from "../src/lib/db/types.ts";
import { createElement } from "react";
import { renderDocumentPdf } from "../src/documents/render.ts";
import { RescuePlan } from "../src/documents/RescuePlan.tsx";
import { LEGAL_BASIS, parseContent, RESCUE_PLAN_TEMPLATE_APPROVED } from "../src/lib/rescue-plans/content.ts";
import { buildPrefill } from "../src/lib/rescue-plans/prefill.ts";
import { finalizeDraft } from "../src/lib/rescue-plans/queries.ts";
import { loadRegistrySnapshot } from "../src/lib/rescue-plans/registry.ts";

/**
 * Kuvitteellinen esimerkkidata kehitykseen ja esittelyyn. Kaikki nimet,
 * osoitteet ja tunnukset ovat keksittyjä (Y-tunnukset tarkistemerkiltään
 * kelvollisia mutta eivät oikeiden yhtiöiden). Idempotentti: ajaa uudelleen
 * vain, jos demo-organisaatiota ei ole. Isännöitsijäntodistuksen tiedot ja
 * liitteet lisätään myös aiemmin luotuun demokantaan, jos niitä ei vielä ole.
 */
const db = await openLocalDb();

/** Demoliite paikalliseen tiedostovarastoon samalla polkurakenteella kuin `storeFile` (vain STORAGE_DRIVER=local). */
async function demoDocument(tx: Sql, o: { org: string; company: string; shareGroup: string | null; category: string; title: string; fileName: string; mime: string; bytes: Uint8Array; year: number | null; visibility: string }) {
  const storagePath = `${o.org}/${o.company}/${randomUUID()}/${o.fileName}`;
  const full = path.join(process.cwd(), ".data", "files", storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, o.bytes);
  await tx.query(
    `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [o.org, o.company, o.shareGroup, o.category, o.title, o.fileName, storagePath, o.mime, o.bytes.length, createHash("sha256").update(o.bytes).digest("hex"), o.visibility, o.year],
  );
}

/** Isännöitsijäntodistuksen demotiedot As Oy Esimerkkirinteelle (0090–0091). */
async function seedCertificateDemo(tx: Sql, org: string, rinne: string) {
  const [done] = await tx.query("select 1 from er_housing_companies where id = $1 and registered_on is not null", [rinne]);
  if (done) return false;
  const groups = Object.fromEntries(
    (await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1", [rinne])).map((g) => [g.unit_label, g.id]),
  );

  await tx.query(
    `update er_organizations set settings = settings || $2::jsonb where id = $1`,
    [org, JSON.stringify({ contact: { phone: "010 000 0000", email: "isannointi@example.test", street_address: "Esimerkkikatu 1", postal_code: "41660", city: "Toivakka" } })],
  );
  await tx.query(
    `update er_housing_companies set registered_on = '2007-11-20', htj_register_transferred_on = '2023-06-12', vat_registered = false,
        charges_decided_by = 'Yhtiökokous', maintenance_needs_report_on = '2026-04-15', maintenance_plan_on = '2024-04-18',
        maintenance_plan_summary = 'Julkisivujen huoltomaalaus 2027, ilmanvaihtokoneiden uusiminen 2029 ja pihan salaojituksen tarkastus 2030.',
        certificate_notes = 'Yhtiökokous 2026 päätti valmistella yhtiöjärjestyksen muutoksen autopaikkojen jakamisesta. Muutos on vireillä.',
        parking_hall_spaces = 0, parking_other_spaces = 4, parking_company_spaces = 0,
        parking_allocation_rules = 'Jokaisella huoneistolla on yksi lämpöpistokepaikka hallituksen päätöksellä.'
      where id = $1`,
    [rinne],
  );
  await tx.query(
    `update er_buildings set staircases = 4, elevators = 0, floor_area_m2 = 520, volume_m3 = 2100, heat_distribution = 'Vesikiertoinen lattialämmitys',
        cooling = 'Ei', antenna = 'Kaapeli-tv', antenna_provider = 'Esimerkkikaapeli Oy', broadband = 'Valokuitu', broadband_provider = 'Esimerkkikuitu Oy',
        energy_class = 'C', energy_certificate_year = 2019
      where company_id = $1`,
    [rinne],
  );
  await tx.query("update er_properties set building_rights_m2 = 800, unused_building_rights_m2 = 150 where company_id = $1", [rinne]);
  await tx.query(
    `update er_loans set loan_type = 'capital_charge', reference_rate = 'Euribor 12 kk', margin_percent = 0.85, purpose = 'Vesikaton uusiminen'
      where company_id = $1 and name = 'Kattoremonttilaina 2023'`,
    [rinne],
  );
  await tx.query(
    `insert into er_loans (organization_id, company_id, name, lender, principal_eur, balance_eur, balance_date, loan_type, interest_percent, allocated)
     values ($1,$2,'Tililimiitti','Esimerkkipankki',10000,0,'2025-12-31','credit_limit',4.5,false)`,
    [org, rinne],
  );
  await tx.query(
    `insert into er_property_mortgages (organization_id, company_id, property_id, amount_eur, holder, registered_on)
     select $1, $2, p.id, v.amount, v.holder, v.registered::date
       from er_properties p, (values (150000, 'Esimerkkipankki, Kattoremonttilaina 2023', '2023-09-15'), (50000, 'Yhtiön hallussa', '2008-05-02')) as v(amount, holder, registered)
      where p.company_id = $2`,
    [org, rinne],
  );
  await tx.query(
    `insert into er_company_insurances (organization_id, company_id, insurance_type, name, insurer, description)
     values ($1,$2,'Kiinteistövakuutus','Täysarvovakuutus','Esimerkkivakuutus','Sisältää vuotovahingot ja rakennusajan vakuutuksen'),
            ($1,$2,'Vastuuvakuutus','Hallituksen vastuuvakuutus','Esimerkkivakuutus',null)`,
    [org, rinne],
  );
  await tx.query("update er_maintenance_needs set status = 'decided', decided_on = '2026-04-15' where company_id = $1 and target = 'Julkisivut'", [rinne]);
  await tx.query(
    "update er_share_groups set votes = 1, area_verified = true, staircase = 'A', street_address = 'Rinnetie 4 A ' || split_part(unit_label, ' ', 2) where company_id = $1",
    [rinne],
  );
  await tx.query(
    "update er_share_groups set certificate_notes = 'Kylpyhuoneen lattiakaivon tiivisteessä todettiin vuoto 2025; korjattu yhtiön toimesta 10/2025.', spouses_common_home = 'unknown' where id = $1",
    [groups["A 2"]],
  );

  const docs: { category: string; title: string; fileName: string; bytes: Uint8Array; mime: string; year: number | null; unit?: string }[] = [
    { category: "articles", title: "Yhtiöjärjestys", fileName: "yhtiojarjestys.pdf", bytes: await makePdf(2, "Yhtiojarjestys"), mime: "application/pdf", year: null },
    { category: "financial_statement", title: "Tilinpäätös ja toimintakertomus 2025", fileName: "tilinpaatos-2025.pdf", bytes: await makePdf(3, "Tilinpaatos 2025"), mime: "application/pdf", year: 2025 },
    { category: "budget", title: "Talousarvio 2026", fileName: "talousarvio-2026.pdf", bytes: await makePdf(1, "Talousarvio 2026"), mime: "application/pdf", year: 2026 },
    { category: "energy_certificate", title: "Energiatodistus", fileName: "energiatodistus.pdf", bytes: await makePdf(1, "Energiatodistus"), mime: "application/pdf", year: 2019 },
    { category: "maintenance_needs_report", title: "Kunnossapitotarveselvitys 2026", fileName: "kpts-2026.pdf", bytes: await makePdf(1, "Kunnossapitotarveselvitys 2026"), mime: "application/pdf", year: 2026 },
    { category: "floor_plan", title: "Pohjapiirustus A 1", fileName: "pohjakuva-a1.png", bytes: makePng(640, 420), mime: "image/png", year: null, unit: "A 1" },
    { category: "floor_plan", title: "Pohjapiirustus A 2", fileName: "pohjakuva-a2.png", bytes: makePng(420, 600), mime: "image/png", year: null, unit: "A 2" },
  ];
  for (const d of docs) {
    await demoDocument(tx, { org, company: rinne, shareGroup: d.unit ? groups[d.unit] : null, category: d.category, title: d.title, fileName: d.fileName, mime: d.mime, bytes: d.bytes, year: d.year, visibility: "owners" });
  }
  await tx.query(
    `insert into er_certificate_orders (organization_id, company_id, share_group_id, orderer_name, orderer_email, price_eur, source, with_attachments, purpose)
     values ($1,$2,$3,'Välittäjä Esimerkki','valittaja@example.test',120,'public_form',true,'sale')`,
    [org, rinne, groups["A 2"]],
  );
  return true;
}

/**
 * Pelastussuunnitelman demoversio As Oy Esimerkkirinteelle (0092): esitäyttö
 * rekisteristä, demon omat tiedot, valmis PDF dokumentiksi ja tarkistus
 * vuosikelloon. Ei tehdä, jos yhtiöllä on jo suunnitelma.
 */
async function seedRescuePlanDemo(tx: Sql, org: string, rinne: string) {
  const [done] = await tx.query("select 1 from er_rescue_plans where company_id = $1", [rinne]);
  if (done) return false;
  const snapshot = await loadRegistrySnapshot(tx, rinne, "2026-09-15");
  if (!snapshot) return false;
  const [company] = await tx.query<{ manager_user_id: string | null; business_id: string; org_name: string }>(
    "select c.manager_user_id, c.business_id, o.name as org_name from er_housing_companies c join er_organizations o on o.id = c.organization_id where c.id = $1",
    [rinne],
  );
  if (!company?.manager_user_id) return false;
  const managerId = company.manager_user_id;
  const content = {
    ...buildPrefill(snapshot),
    storages: "Asuntokohtaiset kylmät varastot rakennuksen päädyissä ja yhteinen ulkoiluvälinevarasto.",
    keySystem: "Yleisavain on isännöitsijällä ja kiinteistöhuollolla.",
    safetyPersons: "Hallituksen puheenjohtaja vastaa turvallisuusasioiden käytännön järjestelyistä yhdessä isännöitsijän kanssa.",
    otherContacts: "Sähkön vikailmoitus: Esimerkkisähkö Oy 0800 000 000\nVesilaitos: Esimerkkikunnan vesihuolto 014 000 000",
    extinguishers: "Sammutuspeite jokaisen asunnon keittiössä. Käsisammutin saunan pukuhuoneessa.",
    assemblyPoint: "Pihan leikkipaikan vieressä",
    assemblyPointAlt: "Kadun toisella puolella olevan pysäköintialueen reuna",
    shutoffWater: "Tekninen tila A-rakennuksen päädyssä, sulku lattian rajassa (merkitty)",
    shutoffElectricity: "Pääkeskus teknisessä tilassa A-rakennuksen päädyssä",
    shutoffVentilation: "Huoneistokohtainen ilmanvaihtokone, katkaisin eteisen kaapissa",
    shutoffHeating: "Maalämpöpumppu teknisessä tilassa, huoltokytkin laitteen kyljessä",
    shelter: "none" as const,
    shelterNotes: "Lähimmän yleisen väestönsuojan osoittaa kunta tarvittaessa.",
    boardApprovedOn: "2026-09-10",
  };
  const [plan] = await tx.query<{ id: string }>(
    `insert into er_rescue_plans (organization_id, company_id, version, status, content, prepared_on, next_review_on, visibility, created_by, updated_by)
     values ($1,$2,1,'draft',$3,'2026-09-15','2027-09-15','residents',$4,$4) returning id`,
    [org, rinne, JSON.stringify(content), managerId],
  );
  const pdf = await renderDocumentPdf(
    createElement(RescuePlan, {
      data: {
        approved: RESCUE_PLAN_TEMPLATE_APPROVED, status: "final", organizationName: company.org_name, businessId: company.business_id, version: 1,
        preparedOn: "2026-09-15", nextReviewOn: "2027-09-15", issuedOn: "2026-09-15", legalBasis: LEGAL_BASIS, content: parseContent(content), attachments: [],
      },
    }),
  );
  const fileName = "pelastussuunnitelma-v1-2026-09-15.pdf";
  const storagePath = `${org}/${rinne}/${randomUUID()}/${fileName}`;
  const full = path.join(process.cwd(), ".data", "files", storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, pdf.bytes);
  await finalizeDraft(tx, {
    planId: plan.id,
    userId: managerId,
    document: { title: "Pelastussuunnitelma As Oy Esimerkkirinne (versio 1)", fileName, storagePath, mimeType: "application/pdf", sizeBytes: pdf.sizeBytes, sha256: pdf.sha256 },
  });
  return true;
}

await db.asService(async (tx) => {
  const [existing] = await tx.query<{ id: string }>("select id from er_organizations where business_id = '0000001-9'");
  if (existing) {
    const [rinne] = await tx.query<{ id: string }>("select id from er_housing_companies where organization_id = $1 and business_id = '1000000-9'", [existing.id]);
    const added = rinne ? await seedCertificateDemo(tx, existing.id, rinne.id) : false;
    const rescue = rinne ? await seedRescuePlanDemo(tx, existing.id, rinne.id) : false;
    console.log(
      [
        added ? "Demodata oli jo kannassa; lisättiin isännöitsijäntodistuksen tiedot ja liitteet." : "Demodata on jo kannassa.",
        rescue ? "Lisättiin pelastussuunnitelman demoversio." : null,
      ].filter(Boolean).join(" "),
    );
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
  await seedCertificateDemo(tx, org.id, rinne);
  await seedRescuePlanDemo(tx, org.id, rinne);
  console.log("Demodata luotu: Demo Isännöinti Oy, 2 taloyhtiötä, 14 huoneistoa, 6 käyttäjää.");
});

await db.close();
