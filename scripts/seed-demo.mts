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
import { createAnnualCycleForCompany } from "../src/lib/tasks/queries.ts";
import { approveBillingRun, createBillingRun } from "../src/lib/finance/billing.ts";
import { addItem, createMeeting, prefillAttendees } from "../src/lib/meetings/mutations.ts";

/**
 * Kuvitteellinen esimerkkidata kehitykseen ja esittelyyn. Kaikki nimet,
 * osoitteet ja tunnukset ovat keksittyjä (Y-tunnukset tarkistemerkiltään
 * kelvollisia mutta eivät oikeiden yhtiöiden). Idempotentti: ajaa uudelleen
 * vain, jos demo-organisaatiota ei ole. Isännöitsijäntodistuksen tiedot ja
 * liitteet lisätään myös aiemmin luotuun demokantaan, jos niitä ei vielä ole.
 */
/** Valinnainen argumentti: toinen kantahakemisto (esim. tyhjä kansio demodatan kokeiluun). */
const db = await openLocalDb(process.argv[2]);

/** Demoliite paikalliseen tiedostovarastoon samalla polkurakenteella kuin `storeFile` (vain STORAGE_DRIVER=local). */
async function demoDocument(
  tx: Sql,
  o: {
    org: string; company: string; shareGroup: string | null; category: string; title: string; fileName: string; mime: string; bytes: Uint8Array;
    year: number | null; visibility: string; subject?: { table: string; id: string };
  },
) {
  const storagePath = `${o.org}/${o.company}/${randomUUID()}/${o.fileName}`;
  const full = path.join(process.cwd(), ".data", "files", storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, o.bytes);
  await tx.query(
    `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year,
                               subject_table, subject_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [o.org, o.company, o.shareGroup, o.category, o.title, o.fileName, storagePath, o.mime, o.bytes.length, createHash("sha256").update(o.bytes).digest("hex"), o.visibility, o.year,
      o.subject?.table ?? null, o.subject?.id ?? null],
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
    // Todistushinnat ovat isännöinnin omia (0116), joten demo antaa ne asetuksissa.
    [org, JSON.stringify({
      contact: { phone: "010 000 0000", email: "isannointi@example.test", street_address: "Esimerkkikatu 1", postal_code: "41660", city: "Toivakka" },
      certificate_prices: { standard_eur: 120, express_eur: 180, with_attachments_eur: null },
    })],
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

/**
 * Muutostyöilmoituksen demo As Oy Esimerkkirinteelle (0093): yhtiön
 * muutostyöohje osakkaille näkyvänä ja Olli Osakkaan ilmoitus kahdella
 * työllä, urakoitsijatiedoilla, liitteellä ja ohjeen kuittauksella.
 * Ei tehdä, jos yhtiöllä on jo muutostyöohje.
 */
async function seedRenovationDemo(tx: Sql, org: string, rinne: string) {
  const [done] = await tx.query("select 1 from er_documents where company_id = $1 and category = 'renovation_guide'", [rinne]);
  if (done) return false;
  await demoDocument(tx, {
    org, company: rinne, shareGroup: null, category: "renovation_guide", title: "Muutostyöohje", fileName: "muutostyoohje.pdf",
    mime: "application/pdf", bytes: await makePdf(2, "Muutostyoohje"), year: 2026, visibility: "owners",
  });
  const [owner] = await tx.query<{ share_group_id: string; user_id: string; party_id: string | null }>(
    `select a.share_group_id, a.user_id, p.id as party_id
       from er_portal_access a join er_share_groups g on g.id = a.share_group_id
       left join er_parties p on p.user_id = a.user_id and p.organization_id = a.organization_id
      where g.company_id = $1 and g.unit_label = 'A 2' and a.role = 'owner' limit 1`,
    [rinne],
  );
  if (!owner) return true;
  const [guide] = await tx.query<{ id: string }>("select id from er_documents where company_id = $1 and category = 'renovation_guide' limit 1", [rinne]);
  const [notice] = await tx.query<{ id: string }>(
    `insert into er_renovation_notices (organization_id, company_id, share_group_id, submitted_by_user_id, submitted_by_party_id, description,
        guide_acknowledged_at, guide_document_id, notify_email, notify_sms)
     values ($1,$2,$3,$4,$5,'Kylpyhuoneen remontti: vedeneristys, laatoitus ja sähköt uusitaan.', now() - interval '2 days', $6, true, false) returning id`,
    [org, rinne, owner.share_group_id, owner.user_id, owner.party_id, guide.id],
  );
  await tx.query(
    `insert into er_renovation_notice_works (organization_id, notice_id, sort_order, work_type, description, planned_start, planned_end,
        contractor_kind, contractor_name, contractor_business_id, contractor_contact, contractor_qualification)
     values ($1,$2,1,'Märkätilat','Vanhat laatat ja vedeneristys puretaan, uusi vedeneristys ja laatoitus. Lattiakaivo uusitaan.','2026-10-12','2026-11-06',
             'contractor','Esimerkkiremontti Oy','3000000-1','Työnjohtaja Rami Remontti, 040 000 0001','Sertifioitu vedeneristäjä (VTT)'),
            ($1,$2,2,'Sähköjärjestelmä','Kylpyhuoneen valaistus ja pistorasiat uusitaan, lisätään sähköinen lattialämmitys.','2026-10-19','2026-10-23',
             'contractor','Esimerkkisähkö Oy',null,'040 000 0002','Sähköpätevyys S2')`,
    [org, notice.id],
  );
  const bytes = await makePdf(1, "Kylpyhuoneen suunnitelma");
  const storagePath = `${org}/${rinne}/${randomUUID()}/kylpyhuoneen-suunnitelma.pdf`;
  const full = path.join(process.cwd(), ".data", "files", storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  await tx.query(
    `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256,
        visibility, subject_table, subject_id, uploaded_by)
     values ($1,$2,$3,'other','Muutostyöilmoituksen liite','kylpyhuoneen-suunnitelma.pdf',$4,'application/pdf',$5,$6,'owners','er_renovation_notices',$7,$8)`,
    [org, rinne, owner.share_group_id, storagePath, bytes.length, createHash("sha256").update(bytes).digest("hex"), notice.id, owner.user_id],
  );
  return true;
}

/**
 * Vastuunjakotaulukon esimerkkipoikkeus As Oy Esimerkkirinteelle (0094):
 * parvekelasit osakkaan vastuulla yhtiöjärjestyksen perusteella. Kuvitteellinen
 * määräys. Idempotentti: ei korvaa käsin muutettua poikkeusta.
 */
async function seedResponsibilityDemo(tx: Sql, org: string, rinne: string) {
  const [manager] = await tx.query<{ manager_user_id: string | null }>("select manager_user_id from er_housing_companies where id = $1", [rinne]);
  const rows = await tx.query(
    `insert into er_responsibility_exceptions (organization_id, company_id, item_key, responsibility, basis, note, decided_on, created_by, updated_by)
     values ($1, $2, 'parveke-lasit', 'shareholder', 'articles',
             'Yhtiöjärjestyksen 5 §:n mukaan osakas vastaa huoneistonsa parvekelasien ja niiden tiivisteiden kunnossapidosta. Yhtiö vastaa edelleen parvekelaatasta ja kaiteesta.',
             '2019-04-25', $3, $3)
     on conflict (company_id, item_key) do nothing returning id`,
    [org, rinne, manager?.manager_user_id ?? null],
  );
  return rows.length > 0;
}

/**
 * Syyskuun 2026 moduulien esimerkkidata As Oy Esimerkkirinteelle: vesimittarit,
 * ennakot ja lukukierrokset, turvallisuustiedot, muutostyöohjeen asetukset,
 * muutostyön valvonta, isännöinnin aloittama viesti ja vakiovuosikello.
 * Idempotentti: kukin osa lisätään vain, jos sitä ei vielä ole.
 */
async function seedSeptemberModulesDemo(tx: Sql, org: string, rinne: string): Promise<string[]> {
  const added: string[] = [];
  const groups = new Map(
    (await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1", [rinne])).map((g) => [g.unit_label, g.id]),
  );
  const [owner] = await tx.query<{ user_id: string }>(
    `select a.user_id from er_portal_access a where a.share_group_id = $1 and a.role = 'owner' limit 1`,
    [groups.get("A 2") ?? null],
  );
  const [manager] = await tx.query<{ manager_user_id: string | null }>("select manager_user_id from er_housing_companies where id = $1", [rinne]);

  const [hasMeters] = await tx.query("select 1 from er_water_meters where company_id = $1", [rinne]);
  if (!hasMeters && groups.size > 0) {
    await tx.query(
      `insert into er_charge_bases (organization_id, company_id, charge_type, label, basis, unit_price, starts_on, decided_on)
       values ($1,$2,'water','Vesimaksu','meter',5.56,'2025-01-01','2024-11-20'), ($1,$2,'hot_water','Lämmin vesi','meter',10.62,'2025-01-01','2024-11-20')`,
      [org, rinne],
    );
    const meter = async (unit: string, kind: "cold" | "hot", start: number) =>
      (await tx.query<{ id: string }>(
        `insert into er_water_meters (organization_id, company_id, share_group_id, kind, meter_number, location, installed_on, start_reading)
         values ($1,$2,$3,$4,$5,'Kylpyhuone','2024-12-31',$6) returning id`,
        [org, rinne, groups.get(unit), kind, `${kind === "cold" ? "K" : "L"}-${unit.replace(" ", "")}`, start],
      ))[0].id;
    const meters = {
      a1c: await meter("A 1", "cold", 187), a1h: await meter("A 1", "hot", 57), a2c: await meter("A 2", "cold", 140),
      a3c: await meter("A 3", "cold", 96), a4c: await meter("A 4", "cold", 211),
    };
    await tx.query(
      `insert into er_water_advances (organization_id, company_id, share_group_id, monthly_eur, starts_on, note)
       values ($1,$2,$3,25.00,'2025-01-01','Sovittu osakkaan kanssa'), ($1,$2,$4,15.00,'2025-01-01',null)`,
      [org, rinne, groups.get("A 1"), groups.get("A 2")],
    );
    const round = async (readOn: string, reportBy: string, status: string, portalOpen: boolean) =>
      (await tx.query<{ id: string }>(
        `insert into er_water_reading_rounds (organization_id, company_id, read_on, report_by, status, portal_open, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [org, rinne, readOn, reportBy, status, portalOpen, manager?.manager_user_id ?? null],
      ))[0].id;
    const closed = await round("2025-12-31", "2026-01-09", "closed", false);
    const readings: [string, number][] = [[meters.a1c, 221.5], [meters.a1h, 70.25], [meters.a2c, 151], [meters.a3c, 131.2], [meters.a4c, 248.9]];
    for (const [meterId, value] of readings) {
      await tx.query(
        "insert into er_water_readings (organization_id, meter_id, round_id, read_on, reading, source, entered_by) values ($1,$2,$3,'2025-12-31',$4,'staff',$5)",
        [org, meterId, closed, value, manager?.manager_user_id ?? null],
      );
    }
    const open = await round("2026-09-30", "2026-10-07", "open", true);
    if (owner) {
      await tx.query(
        "insert into er_water_readings (organization_id, meter_id, round_id, read_on, reading, source, entered_by) values ($1,$2,$3,'2026-09-30',159.4,'portal',$4)",
        [org, meters.a2c, open, owner.user_id],
      );
    }
    added.push("vesimittarit, ennakot ja lukukierrokset");
  }

  const safety = await tx.query(
    `update er_housing_companies set shelter = 'own', shelter_location = 'A-rapun kellari, ovi porraskäytävästä', shelter_capacity = 'noin 40 henkilöä',
            assembly_point = 'Pihan leikkipaikka', assembly_point_alt = 'Rinnetien kääntöpaikka', shutoff_water = 'Lämmönjakohuone, kellari',
            shutoff_electricity = 'Sähköpääkeskus, A-rapun kellari', shutoff_ventilation = 'IV-konehuone, ullakko', shutoff_heating = 'Lämmönjakohuone, kellari'
      where id = $1 and shelter is null returning id`,
    [rinne],
  );
  if (safety.length) added.push("turvallisuustiedot");

  const guide = await tx.query(
    `update er_housing_companies set renovation_guide_settings = $2::jsonb where id = $1 and renovation_guide_settings = '{}'::jsonb returning id`,
    [rinne, JSON.stringify({ processingFee: "Muutostyöilmoituksen käsittelystä peritään 50 € (hallituksen päätös 12.3.2026).", extra: "Parvekelasitus on sallittu yhtiön hyväksymällä mallilla (yhtiökokous 2025)." })],
  );
  if (guide.length) added.push("muutostyöohjeen asetukset");

  const supervision = await tx.query(
    `update er_renovation_notices set supervisor = 'Esimerkkivalvonta Oy, Ville Valvoja, 040 000 0003', supervision_cost_eur = 240,
            supervision_cost_basis = '2 tarkastuskäyntiä à 120 € (alv 0 %)'
      where company_id = $1 and supervisor is null returning id`,
    [rinne],
  );
  if (supervision.length) added.push("muutostyön valvoja ja kustannusarvio");

  const [thread] = await tx.query("select 1 from er_contact_threads where company_id = $1 and started_by_staff", [rinne]);
  if (!thread && owner && manager?.manager_user_id) {
    const [t] = await tx.query<{ id: string }>(
      `insert into er_contact_threads (organization_id, company_id, share_group_id, created_by_user_id, participant_user_id, started_by_staff, topic, subject, status)
       values ($1,$2,$3,$4,$5,true,'general','Kylpyhuoneen tarkastuskäynti','answered') returning id`,
      [org, rinne, groups.get("A 2"), manager.manager_user_id, owner.user_id],
    );
    await tx.query(
      "insert into er_contact_messages (organization_id, thread_id, author_user_id, from_staff, body) values ($1,$2,$3,true,$4)",
      [org, t.id, manager.manager_user_id, "Hei, muutostyön valvoja tekee ensimmäisen tarkastuskäynnin purkutöiden jälkeen. Sopiiko torstai 15.10. klo 9?"],
    );
    added.push("isännöinnin aloittama viesti");
  }

  const [tasks] = await tx.query("select 1 from er_tasks where company_id = $1 and template_key is not null", [rinne]);
  if (!tasks && manager?.manager_user_id) {
    const r = await createAnnualCycleForCompany(tx, { companyId: rinne, userId: manager.manager_user_id, today: new Date().toISOString().slice(0, 10) });
    if (r?.created) added.push("vakiovuosikello");
  }
  return added;
}

/** Kokouksen päätösteksti otsikon mukaan; tuntemattomalle asialle merkintä tiedoksi. */
const MEETING_DECISIONS: [RegExp, string][] = [
  [/avaus/i, "Hallituksen puheenjohtaja Paula Puheenjohtaja avasi kokouksen klo 18.00."],
  [/puheenjohtaja.*sihteeri|valitaan kokouksen puheenjohtaja/i, "Kokouksen puheenjohtajaksi valittiin Paula Puheenjohtaja ja sihteeriksi isännöitsijä Iida Isännöitsijä."],
  [/pöytäkirjantarkastaj/i, "Pöytäkirjantarkastajaksi ja ääntenlaskijaksi valittiin Olli Osakas."],
  [/laillisuu|päätösvaltai/i, "Kokouskutsu todettiin toimitetuksi yhtiöjärjestyksen mukaisesti ja kokous lailliseksi ja päätösvaltaiseksi."],
  [/läsnäolij|ääniluettelo/i, "Läsnä oli kolme osakasta, jotka edustivat 402 osaketta yhtiön 500 osakkeesta. Ääniluettelo on pöytäkirjan liitteenä."],
  [/esityslistan hyväksy|työjärjesty/i, "Esityslista hyväksyttiin kokouksen työjärjestykseksi."],
  [/tilinpäätös|toimintakertomus|tilintarkastuskertomus|toiminnantarkastuskertomus/i, "Isännöitsijä esitteli tilinpäätöksen ja toimintakertomuksen tilikaudelta 1.1.–31.12.2025 sekä toiminnantarkastuskertomuksen."],
  [/vahvistaminen/i, "Tuloslaskelma ja tase vahvistettiin esitetyssä muodossa."],
  [/ylijäämä|alijäämä|voiton käytt/i, "Päätettiin, että tilikauden ylijäämä siirretään edellisten tilikausien tilille eikä varoja jaeta."],
  [/vastuuvapau/i, "Hallituksen jäsenille ja isännöitsijälle myönnettiin vastuuvapaus tilikaudelta 2025."],
  [/talousarvio|vastikk/i, "Talousarvio vuodelle 2026 vahvistettiin. Hoitovastike on 3,00 €/m² kuukaudessa ja vesimaksu 5,56 €/m³ kulutuksen mukaan."],
  [/kunnossapitotarve|selvitys kunnossapidosta|kunnossapito/i, "Merkittiin tiedoksi hallituksen selvitykset: vesikatto uusittiin 2024 ja seuraavina viitenä vuotena ovat edessä julkisivujen huoltomaalaus 2027 ja ilmanvaihtokoneiden uusiminen 2029."],
  [/hallituksen jäsen/i, "Hallitukseen valittiin Paula Puheenjohtaja, Olli Osakas ja Matti Meikäläinen sekä varajäseneksi Veera Vuokranantaja."],
  [/tarkastaja/i, "Toiminnantarkastajaksi valittiin Teemu Tarkastaja ja varatoiminnantarkastajaksi Tiina Tarkastaja."],
  [/palkkio/i, "Hallituksen puheenjohtajan palkkioksi päätettiin 600 € ja jäsenen palkkioksi 400 € vuodessa. Toiminnantarkastaja laskuttaa työn mukaan."],
  [/muut asiat/i, "Keskusteltiin pihan pysäköintipaikkojen jaosta. Asia valmistellaan hallituksessa."],
  [/päättäminen/i, "Puheenjohtaja päätti kokouksen klo 19.05."],
];

/**
 * Moduulien M1–M6 esimerkkidata As Oy Esimerkkirinteelle: huoltopyynnöt
 * tapahtumineen (M1), vastikelaskutus ja maksutilanne (M3), tiedotteet ja
 * osakkaan yhteydenotto (M4), pidetty yhtiökokous asiakirjoineen ja
 * valmisteltava hallituksen kokous (M5) sekä varauskohteet, varaukset ja
 * kulutusseuranta (M6). Idempotentti: kukin osa lisätään vain, jos sitä ei
 * vielä ole. Kaikki nimet, summat ja lukemat ovat keksittyjä.
 */
async function seedModulesDemo(tx: Sql, org: string, rinne: string): Promise<string[]> {
  const added: string[] = [];
  const groups = new Map(
    (await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1", [rinne])).map((g) => [g.unit_label, g.id]),
  );
  const [company] = await tx.query<{ manager_user_id: string | null }>("select manager_user_id from er_housing_companies where id = $1", [rinne]);
  const manager = company?.manager_user_id ?? null;
  const userByEmail = async (email: string) =>
    (await tx.query<{ id: string }>("select id from er_users where email = $1", [email]))[0]?.id ?? null;
  const ownerUser = await userByEmail("olli.osakas@example.test");
  const tenantUser = await userByEmail("anna.asukas@example.test");
  const [provider] = await tx.query<{ id: string }>("select id from er_service_providers where organization_id = $1 limit 1", [org]);

  // --- M1 Huolto: pyynnöt eri vaiheissa ja niiden tapahtumat ----------------
  const [hasRequests] = await tx.query("select 1 from er_service_requests where company_id = $1", [rinne]);
  if (!hasRequests) {
    const request = async (r: {
      unit: string | null; title: string; description: string; category: string; urgency: string; status: string; source: string;
      reporterUserId?: string | null; reporterName?: string | null; reporterPhone?: string | null; providerId?: string | null;
      costEur?: number | null; costResponsibility?: string; masterKey?: boolean; pets?: boolean; orderedAt?: string | null;
    }) =>
      (await tx.query<{ id: string; number: number }>(
        `insert into er_service_requests (organization_id, company_id, share_group_id, title, description, category, urgency, status, source,
            reporter_user_id, reporter_name, reporter_phone, assignee_user_id, provider_id, cost_eur, cost_responsibility, may_use_master_key, has_pets, ordered_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id, number`,
        [org, rinne, r.unit ? groups.get(r.unit) : null, r.title, r.description, r.category, r.urgency, r.status, r.source,
          r.reporterUserId ?? null, r.reporterName ?? null, r.reporterPhone ?? null, manager, r.providerId ?? null, r.costEur ?? null,
          r.costResponsibility ?? "unclear", r.masterKey ?? false, r.pets ?? false, r.orderedAt ?? null],
      ))[0];
    const event = async (requestId: string, e: { type: string; body?: string | null; oldStatus?: string | null; newStatus?: string | null; visibility?: string; userId?: string | null }) =>
      tx.query(
        `insert into er_service_request_events (organization_id, request_id, type, body, old_status, new_status, visibility, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [org, requestId, e.type, e.body ?? null, e.oldStatus ?? null, e.newStatus ?? null, e.visibility ?? "internal", e.userId ?? manager],
      );

    const leak = await request({
      unit: "A 3", title: "Keittiön hana vuotaa", description: "Hanan juuresta tippuu vettä kaapin pohjalle. Sulkuventtiili on kiinni.",
      category: "plumbing", urgency: "normal", status: "done", source: "portal", reporterUserId: tenantUser, reporterPhone: "040 000 0010",
      providerId: provider?.id ?? null, costEur: 145, costResponsibility: "company", masterKey: true, orderedAt: "2026-09-08T06:30:00Z",
    });
    await event(leak.id, { type: "status_change", oldStatus: "new", newStatus: "ordered", body: "Tilattu kiinteistöhuollolle." });
    await event(leak.id, { type: "comment", visibility: "reporter", body: "Asentaja käy torstaina klo 9–11. Yleisavainta saa käyttää." });
    await event(leak.id, { type: "status_change", oldStatus: "ordered", newStatus: "done", body: "Hanan sekoittajaosa vaihdettu." });
    await event(leak.id, { type: "cost", body: "Työ ja tarvikkeet 145 € (alv 0 %). Yhtiön vastuulla, kohdistuu hoitovastikkeeseen." });

    const light = await request({
      unit: null, title: "Ulkovalaisin ei syty A-rapun päädyssä", description: "Puheenjohtaja ilmoitti kierroksella. Valaisin pimeänä kahden viikon ajan.",
      category: "electrical", urgency: "normal", status: "ordered", source: "staff", reporterName: "Paula Puheenjohtaja",
      providerId: provider?.id ?? null, costResponsibility: "company", orderedAt: "2026-09-18T07:00:00Z",
    });
    await event(light.id, { type: "status_change", oldStatus: "new", newStatus: "ordered", body: "Tilattu sähköurakoitsijalta. Arvioitu käynti viikolla 39." });

    const heat = await request({
      unit: "A 2", title: "Olohuoneen patteri ei lämpene", description: "Patteri jää kylmäksi, vaikka termostaatti on täysillä. Muut patterit lämpiävät.",
      category: "heating", urgency: "urgent", status: "received", source: "portal", reporterUserId: ownerUser, reporterPhone: "040 000 0011", pets: true,
    });
    await event(heat.id, { type: "status_change", oldStatus: "new", newStatus: "received", body: "Vastaanotettu. Ilmataan patteri ja tarkistetaan kiertovesipumppu.", visibility: "reporter" });
    added.push("huoltopyynnöt");
  }

  // --- M3 Talous: laskutusasetukset, vastikeajot ja maksutilanne ------------
  const [hasBilling] = await tx.query("select 1 from er_company_billing_settings where company_id = $1", [rinne]);
  if (!hasBilling && manager) {
    await tx.query(
      `insert into er_company_billing_settings (organization_id, company_id, company_number, due_day, bank_iban, bank_bic, billing_note)
       values ($1,$2,101,5,'FI21 1234 5600 0007 85','NDEAFIHH','Maksathan vastikkeen viitenumerolla. Muistutusmaksu 5 €.')`,
      [org, rinne],
    );
    // Elokuu on hyväksytty ja syyskuu luonnoksena, jotta molemmat tilat näkyvät.
    const august = await createBillingRun(tx, { companyId: rinne, month: "2026-08", userId: manager });
    await approveBillingRun(tx, august.runId, rinne, manager);
    await createBillingRun(tx, { companyId: rinne, month: "2026-09", userId: manager });

    const owners = await tx.query<{ share_group_id: string; party_id: string; unit_label: string }>(
      `select o.share_group_id, o.party_id, g.unit_label from er_ownerships o join er_share_groups g on g.id = o.share_group_id
        where g.company_id = $1 and o.ends_on is null`,
      [rinne],
    );
    for (const o of owners) {
      const overdue = o.unit_label === "A 2" ? 312.5 : 0;
      await tx.query(
        `insert into er_payment_status (organization_id, company_id, share_group_id, party_id, open_eur, overdue_eur, oldest_due_on, as_of, source)
         values ($1,$2,$3,$4,$5,$5,$6,'2026-09-15','csv')`,
        [org, rinne, o.share_group_id, o.party_id, overdue, overdue > 0 ? "2026-07-05" : null],
      );
    }
    added.push("vastikelaskutus ja maksutilanne");
  }

  // --- M4 Viestintä: tiedotteet ja osakkaan yhteydenotto --------------------
  // Otsikolla, koska pelastussuunnitelman demo luo oman tiedotteensa.
  const [hasAnnouncement] = await tx.query("select 1 from er_announcements where company_id = $1 and title = 'Pihan talkoot lauantaina 4.10.'", [rinne]);
  if (!hasAnnouncement && manager) {
    await tx.query(
      `insert into er_announcements (organization_id, company_id, title, body, audience_roles, channels, status, published_at, published_by, author_user_id,
          valid_until, recipient_party_count, email_recipient_count, missing_email_count)
       values ($1,$2,$3,$4,'{owner,resident}','{portal,email}','published','2026-09-12T06:00:00Z',$5,$5,'2026-10-15',5,4,1)`,
      [org, rinne, "Pihan talkoot lauantaina 4.10.",
        [
          "Hei,",
          "",
          "pihatalkoot pidetään lauantaina 4.10. klo 10 alkaen. Haravoimme lehdet, siirrämme kesäkalusteet varastoon ja tarkistamme syöksytorvet.",
          "Yhtiö tarjoaa työvälineet, makkarat ja kahvit. Ilmoittautumista ei tarvita.",
          "",
          "Terveisin isännöinti",
        ].join("\n"), manager],
    );
    await tx.query(
      `insert into er_announcements (organization_id, company_id, title, body, audience_roles, channels, status, author_user_id)
       values ($1,$2,$3,$4,'{owner,resident}','{portal,email}','draft',$5)`,
      [org, rinne, "Talveen varautuminen",
        [
          "Hei,",
          "",
          "muistathan talven tullen: pidä parvekkeen kaivo puhtaana, älä säilytä tavaraa poistumisteillä ja ilmoita lumen kertymisestä katolle isännöintiin.",
          "Kiinteistöhuolto vastaa pihan aurauksesta ja hiekoituksesta.",
          "",
          "Terveisin isännöinti",
        ].join("\n"), manager],
    );
    added.push("tiedotteet");
  }

  const [hasPortalThread] = await tx.query("select 1 from er_contact_threads where company_id = $1 and not started_by_staff", [rinne]);
  if (!hasPortalThread && ownerUser && manager) {
    const [thread] = await tx.query<{ id: string }>(
      `insert into er_contact_threads (organization_id, company_id, share_group_id, created_by_user_id, participant_user_id, topic, subject, status)
       values ($1,$2,$3,$4,$4,'charges','Vastikkeen eräpäivä ja viitenumero','answered') returning id`,
      [org, rinne, groups.get("A 2"), ownerUser],
    );
    await tx.query(
      "insert into er_contact_messages (organization_id, thread_id, author_user_id, from_staff, body) values ($1,$2,$3,false,$4)",
      [org, thread.id, ownerUser, "Hei, maksoin elokuun vastikkeen väärällä viitteellä. Näkyykö suoritus teillä, ja mikä on oikea viitenumero?"],
    );
    await tx.query(
      "insert into er_contact_messages (organization_id, thread_id, author_user_id, from_staff, body) values ($1,$2,$3,true,$4)",
      [org, thread.id, manager, "Hei, suoritus on kohdistettu käsin, joten mitään ei tarvitse tehdä. Oikea viitenumero näkyy portaalin Talous-sivulla laskun tiedoissa."],
    );
    added.push("osakkaan yhteydenotto");
  }

  // --- M5 Kokoukset: pidetty yhtiökokous ja valmisteltava hallituksen kokous -
  const [hasMeeting] = await tx.query("select 1 from er_meetings where company_id = $1", [rinne]);
  if (!hasMeeting && manager) {
    // Hallituksen ja tarkastajien määrät yhtiöjärjestyksestä (0097), jotta
    // esityslista muodostuu yhtiön omien määrien mukaan.
    await tx.query(
      `update er_housing_companies set board_members_min = 3, board_members_max = 3, board_deputies_min = 1, board_deputies_max = 1,
              auditor_kind = 'operations_auditor', auditors_count = 1, deputy_auditors_count = 1, governance_source = 'Yhtiöjärjestys 5 § ja 8 §'
        where id = $1`,
      [rinne],
    );
    const agm = await createMeeting(tx, {
      companyId: rinne, kind: "annual_general", startsAt: "2026-04-15T15:00:00Z", location: "Kerhohuone, Rinnetie 4",
      remoteParticipation: true, remoteUrl: "https://example.test/kokous", fiscalYear: "2025", createdBy: manager,
    });
    if (agm) {
      await tx.query(
        `update er_meetings set status = 'held', notice_sent_at = '2026-03-25T09:00:00Z', chair_name = 'Paula Puheenjohtaja',
                chair_email = 'paula.puheenjohtaja@example.test', secretary_name = 'Iida Isännöitsijä',
                minutes_checkers = $2::jsonb where id = $1`,
        [agm.id, JSON.stringify([{ name: "Olli Osakas", email: "olli.osakas@example.test" }])],
      );
      const items = await tx.query<{ id: string; title: string }>("select id, title from er_meeting_items where meeting_id = $1 order by position", [agm.id]);
      for (const item of items) {
        const decision = MEETING_DECISIONS.find(([re]) => re.test(item.title))?.[1] ?? "Merkittiin tiedoksi.";
        await tx.query("update er_meeting_items set decision = $2 where id = $1", [item.id, decision]);
      }
      await prefillAttendees(tx, agm.id);
      await tx.query(
        `update er_meeting_attendees set present = true
          where meeting_id = $1 and display_name in ('Paula Puheenjohtaja', 'Olli Osakas', 'Matti Meikäläinen')`,
        [agm.id],
      );
      // Kutsu ja pöytäkirja muodostetaan kokoussivulla napista: asiakirjojen
      // kokoaja on server-only-moduuli, jota skripti ei voi ajaa.
    }

    const board = await createMeeting(tx, {
      companyId: rinne, kind: "board", startsAt: "2026-10-14T15:00:00Z", location: "Isännöintitoimisto, Esimerkkikatu 1",
      remoteParticipation: true, remoteUrl: "https://example.test/hallitus", fiscalYear: "2026", createdBy: manager,
    });
    if (board) {
      await tx.query("update er_meetings set chair_name = 'Paula Puheenjohtaja', secretary_name = 'Iida Isännöitsijä' where id = $1", [board.id]);
      await addItem(tx, board.id, "Pihan talvikunnossapito", "Esitys: hyväksytään Esimerkkihuolto Oy:n tarjous 1 850 € (alv 0 %) kaudelle 2026–2027.");
      await addItem(tx, board.id, "Talousarvio 2027", "Esitys: käydään läpi isännöitsijän laatima talousarvioluonnos ja päätetään esityksestä yhtiökokoukselle.");
      await prefillAttendees(tx, board.id);
    }
    added.push("kokoukset");
  }

  // --- M6 Arki: varauskohteet, varaukset ja kulutusseuranta -----------------
  const [hasResources] = await tx.query("select 1 from er_bookable_resources where company_id = $1", [rinne]);
  if (!hasResources) {
    const evening = { mon: [["16:00", "22:00"]], tue: [["16:00", "22:00"]], wed: [["16:00", "22:00"]], thu: [["16:00", "22:00"]], fri: [["15:00", "22:00"]], sat: [["12:00", "22:00"]], sun: [["12:00", "21:00"]] };
    const day = { mon: [["08:00", "21:00"]], tue: [["08:00", "21:00"]], wed: [["08:00", "21:00"]], thu: [["08:00", "21:00"]], fri: [["08:00", "21:00"]], sat: [["09:00", "18:00"]] };
    const resource = async (r: { name: string; description: string; slot: number; hours: unknown; max: number; recurring: boolean; price: number | null }) =>
      (await tx.query<{ id: string }>(
        `insert into er_bookable_resources (organization_id, company_id, name, description, slot_minutes, open_hours, max_active_bookings_per_unit, allow_recurring, price_eur)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) returning id`,
        [org, rinne, r.name, r.description, r.slot, JSON.stringify(r.hours), r.max, r.recurring, r.price],
      ))[0].id;
    const sauna = await resource({
      name: "Taloyhtiön sauna", description: "Sauna on rakennuksen päädyssä. Lämpiää vuoron alkuun mennessä. Siivoa löylyhuone käytön jälkeen.",
      slot: 60, hours: evening, max: 2, recurring: true, price: 8,
    });
    const laundry = await resource({
      name: "Pesutupa", description: "Pesukone ja kuivausrumpu. Vuoro on kolme tuntia, ja koneet tyhjennetään vuoron päättyessä.",
      slot: 180, hours: day, max: 1, recurring: false, price: null,
    });
    if (ownerUser) {
      await tx.query(
        `insert into er_bookings (organization_id, company_id, resource_id, share_group_id, user_id, starts_at, ends_at, note, created_by)
         values ($1,$2,$3,$4,$5,'2026-09-25T15:00:00Z','2026-09-25T16:00:00Z',null,$5)`,
        [org, rinne, sauna, groups.get("A 2"), ownerUser],
      );
    }
    if (tenantUser) {
      await tx.query(
        `insert into er_bookings (organization_id, company_id, resource_id, share_group_id, user_id, starts_at, ends_at, note, created_by)
         values ($1,$2,$3,$4,$5,'2026-09-26T06:00:00Z','2026-09-26T09:00:00Z','Mattojen pesu',$5)`,
        [org, rinne, laundry, groups.get("A 3"), tenantUser],
      );
    }
    added.push("varauskohteet ja varaukset");
  }

  const [hasConsumption] = await tx.query("select 1 from er_consumption_readings where company_id = $1", [rinne]);
  if (!hasConsumption) {
    // Maalämpöyhtiön sähkö ja lämmitysenergia kuukausittain; luvut keksittyjä
    // mutta vuodenaikojen mukaisia.
    const heat = [18.4, 21.9, 24.1, 23.6, 19.8, 14.2, 8.7, 5.1, 3.9, 3.7, 4.6, 7.8];
    const electricity = [2450, 2780, 2960, 2890, 2610, 2180, 1740, 1490, 1380, 1360, 1520, 1890];
    for (let i = 0; i < 12; i++) {
      const month = new Date(Date.UTC(2025, 9 + i, 1));
      const start = month.toISOString().slice(0, 10);
      const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      await tx.query(
        `insert into er_consumption_readings (organization_id, company_id, utility, period_start, period_end, amount, unit, cost_eur, source, created_by)
         values ($1,$2,'heat',$3,$4,$5,'MWh',$6,'manual',$7), ($1,$2,'electricity',$3,$4,$8,'kWh',$9,'manual',$7)`,
        [org, rinne, start, end, heat[i], Math.round(heat[i] * 78 * 100) / 100, manager, electricity[i], Math.round(electricity[i] * 0.14 * 100) / 100],
      );
    }
    added.push("kulutusseuranta");
  }

  return added;
}

await db.asService(async (tx) => {
  const [existing] = await tx.query<{ id: string }>("select id from er_organizations where business_id = '0000001-9'");
  if (existing) {
    const [rinne] = await tx.query<{ id: string }>("select id from er_housing_companies where organization_id = $1 and business_id = '1000000-9'", [existing.id]);
    const added = rinne ? await seedCertificateDemo(tx, existing.id, rinne.id) : false;
    const rescue = rinne ? await seedRescuePlanDemo(tx, existing.id, rinne.id) : false;
    const renovation = rinne ? await seedRenovationDemo(tx, existing.id, rinne.id) : false;
    const responsibility = rinne ? await seedResponsibilityDemo(tx, existing.id, rinne.id) : false;
    const september = rinne ? await seedSeptemberModulesDemo(tx, existing.id, rinne.id) : [];
    const modules = rinne ? await seedModulesDemo(tx, existing.id, rinne.id) : [];
    console.log(
      [
        added ? "Demodata oli jo kannassa; lisättiin isännöitsijäntodistuksen tiedot ja liitteet." : "Demodata on jo kannassa.",
        rescue ? "Lisättiin pelastussuunnitelman demoversio." : null,
        renovation ? "Lisättiin muutostyöohje ja muutostyöilmoitus." : null,
        responsibility ? "Lisättiin vastuunjaon esimerkkipoikkeus." : null,
        september.length ? `Lisättiin: ${september.join(", ")}.` : null,
        modules.length ? `Lisättiin moduulidata: ${modules.join(", ")}.` : null,
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
  await seedRenovationDemo(tx, org.id, rinne);
  await seedResponsibilityDemo(tx, org.id, rinne);
  await seedSeptemberModulesDemo(tx, org.id, rinne);
  await seedModulesDemo(tx, org.id, rinne);
  console.log("Demodata luotu: Demo Isännöinti Oy, 2 taloyhtiötä, 14 huoneistoa, 6 käyttäjää.");
});

await db.close();
