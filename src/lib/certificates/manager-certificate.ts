import { createElement } from "react";
import type { Sql } from "@/lib/db";
import { isoDateHelsinki } from "@/lib/format";
import { REDEMPTION_CLAUSE, SHARE_GROUP_KIND } from "@/lib/registry/labels";
import { HEATING_TYPE_LABEL, type HeatingType } from "@/lib/consumption/heating";
import { RENOVATION_STATUS_LABEL, type RenovationStatus } from "@/lib/maintenance/renovation";
import { NEED_STATUS_LABEL, type NeedStatus } from "@/lib/maintenance/labels";
import { ManagerCertificate, type ManagerCertificateData } from "@/documents/ManagerCertificate";
import { renderDocumentPdf, type RenderedDocument } from "@/documents/render";
import { formatArea, formatDate, formatEuro, formatInteger, formatShareRanges } from "@/documents/format";
import { computeMonthlyCharges, type ChargeBasisInput } from "./charges";
import { availabilityEntries, findAttachmentCandidates, type AttachmentEntry } from "./attachments";
import {
  asbestosNote, buildingSummary, chargePriceList, loanRow, parsePropertyCode, purposeText, spacesByKind, SPOUSES_HOME_LABEL, yesNo, type LoanInput,
} from "./content";
import { CERTIFICATE_TEMPLATE_APPROVED } from "./pricing";

/**
 * Isännöitsijäntodistuksen tiedot (AOYL 7:27 §, VNa 365/2010, muut.
 * 174/2013 ja 567/2026; luonnos, Jukan hyväksyttävä).
 *
 * Yhtiön tiedot, rakennukset, vastikkeet, lainat ja korjaukset eRapun
 * rekisteristä; omistajat ja panttaukset HTJ:stä (merkintä todistuksessa).
 * Luetaan kutsujan transaktiossa (henkilökunnan RLS).
 */

/**
 * eSinetin julkinen tarkistussivu. Todistuksen tiivistettä ei voi painaa
 * asiakirjaan, koska sinetöinti muuttaa tiedostoa; tarkistussivulle
 * ladataan sinetöity PDF, josta eSinetti laskee tiivisteen.
 */
export const VERIFY_URL = "https://app.esinetti.fi/verify";

export const LEGAL_BASIS = "Asunto-osakeyhtiölaki 7:27 § ja valtioneuvoston asetus 365/2010 (muut. 174/2013 ja 567/2026)";

export interface CertificateOrderInfo {
  purpose: string | null;
  purposeText: string | null;
  ordererName: string | null;
  withAttachments: boolean;
}

/**
 * Maksutilanne M3:n taulusta `er_payment_status` (tuotu kirjanpidosta).
 * Taulussa on rivi jokaiselta tuontipäivältä, joten luetaan uusin. Jos
 * tilannetta ei ole koskaan tuotu, todistukseen ei kirjoiteta mitään
 * (null), koska "ei avoimia maksuja" olisi väite, jota ei ole tarkistettu.
 */
async function readPaymentStatus(tx: Sql, shareGroupId: string): Promise<string | null> {
  const rows = await tx.query<{ overdue_eur: string; open_eur: string; as_of: string }>(
    `select sum(overdue_eur)::text as overdue_eur, sum(open_eur)::text as open_eur, as_of::text as as_of
       from er_payment_status
      where share_group_id = $1 and as_of = (select max(as_of) from er_payment_status where share_group_id = $1)
      group by as_of`,
    [shareGroupId],
  );
  const row = rows[0];
  if (!row) return null;
  const dateText = ` (tilanne ${formatDate(row.as_of)})`;
  const overdue = Number(row.overdue_eur);
  const open = Number(row.open_eur);
  const openText = open > overdue ? `, avoinna yhteensä ${formatEuro(open)}` : "";
  return overdue > 0 ? `Erääntyneitä maksuja ${formatEuro(overdue)}${openText}${dateText}.` : `Ei erääntyneitä maksuja${openText}${dateText}.`;
}

type CompanyRow = {
  name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null; articles_date: string | null;
  total_shares: number | null; insurance_company: string | null; insurance_type: string | null; property_maintenance: string | null;
  redemption_clause: Record<string, boolean>; htj_synced_at: string | null; org_name: string; org_settings: { contact?: Record<string, string | null> } | null;
  manager_name: string | null; manager_email: string | null; manager_phone: string | null; commercial_register_note: string | null;
  registered_on: string | null; certificate_notes: string | null; mortgages_total_eur: string | null; maintenance_needs_report_on: string | null;
  maintenance_plan_on: string | null; maintenance_plan_summary: string | null; htj_register_transferred_on: string | null; vat_registered: boolean | null;
  vat_note: string | null; charges_decided_by: string | null; articles_maintenance_clause: string | null; share_issue_authorization: string | null;
  articles_lawsuit: string | null; parking_hall_spaces: number | null; parking_other_spaces: number | null; parking_company_spaces: number | null;
  parking_allocation_rules: string | null; management_started_on: string | null;
};

const joinAddress = (street: string | null | undefined, postal: string | null | undefined, city: string | null | undefined) =>
  [street, [postal, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

export async function loadManagerCertificateData(
  tx: Sql,
  shareGroupId: string,
  opts: { issuedOn?: string; order?: CertificateOrderInfo; attachments?: AttachmentEntry[] } = {},
): Promise<ManagerCertificateData | null> {
  const [group] = await tx.query<{
    id: string; company_id: string; unit_label: string; kind: string; layout: string | null; floor: string | null; area_m2: string | null;
    intended_use: string | null; share_count: number; building_label: string | null; ranges: { first: number; last: number }[]; htj_id: string | null;
    certificate_notes: string | null; company_possession: boolean; company_possession_decided_on: string | null; company_possession_ends_on: string | null;
    company_rented: boolean; widow_right: boolean | null; spouses_common_home: string | null; other_restrictions: string | null; votes: number | null;
    area_verified: boolean | null; staircase: string | null; street_address: string | null; short_term_rental: boolean;
  }>(
    `select g.id, g.company_id, g.unit_label, g.kind, g.layout, g.floor, g.area_m2::text, g.intended_use, g.share_count, b.label as building_label, g.htj_id,
            g.certificate_notes, g.company_possession, g.company_possession_decided_on::text, g.company_possession_ends_on::text, g.company_rented,
            g.widow_right, g.spouses_common_home, g.other_restrictions, g.votes, g.area_verified, g.staircase, g.street_address,
            exists (select 1 from er_residencies r where r.share_group_id = g.id and r.short_term_rental and (r.ends_on is null or r.ends_on >= current_date)) as short_term_rental,
            coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                        from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
       from er_share_groups g left join er_buildings b on b.id = g.building_id
      where g.id = $1`,
    [shareGroupId],
  );
  if (!group) return null;

  const [company] = await tx.query<CompanyRow>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, c.articles_date::text, c.total_shares,
            c.insurance_company, c.insurance_type, c.property_maintenance, c.redemption_clause, c.htj_synced_at, o.name as org_name, o.settings as org_settings,
            coalesce(u.full_name, u.email) as manager_name, u.email as manager_email, u.phone as manager_phone, c.commercial_register_note,
            c.registered_on::text, c.certificate_notes, c.mortgages_total_eur::text, c.maintenance_needs_report_on::text, c.maintenance_plan_on::text,
            c.maintenance_plan_summary, c.htj_register_transferred_on::text, c.vat_registered, c.vat_note, c.charges_decided_by, c.articles_maintenance_clause,
            c.share_issue_authorization, c.articles_lawsuit, c.parking_hall_spaces, c.parking_other_spaces, c.parking_company_spaces, c.parking_allocation_rules,
            c.management_started_on::text
       from er_housing_companies c join er_organizations o on o.id = c.organization_id left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [group.company_id],
  );
  if (!company) return null;
  const companyId = group.company_id;

  const [properties, buildings, groups, bases, loans, loanShares, works, needs, decided, notices, mortgages, insurances, chair, candidates] = await Promise.all([
    tx.query<{
      property_code: string; tenure: string | null; area_m2: string | null; lessor: string | null; lease_ends_on: string | null; annual_rent_eur: string | null;
      rent_review_basis: string | null; building_rights_m2: string | null; unused_building_rights_m2: string | null; parking_spaces_built: number | null;
    }>(
      `select property_code, tenure, area_m2::text, lessor, lease_ends_on::text, annual_rent_eur::text, rent_review_basis, building_rights_m2::text,
              unused_building_rights_m2::text, parking_spaces_built
         from er_properties where company_id = $1 order by property_code`,
      [companyId],
    ),
    tx.query<{
      label: string | null; completed_year: number | null; building_type: string | null; floors: number | null; staircases: number | null; elevators: number;
      floor_area_m2: string | null; apartment_area_m2: string | null; volume_m3: string | null; construction_material: string | null; roof_type: string | null;
      roof_material: string | null; heating: string | null; heating_type: string | null; heat_distribution: string | null; cooling: string | null;
      ventilation: string | null; antenna: string | null; antenna_provider: string | null; broadband: string | null; broadband_provider: string | null;
      energy_class: string | null; energy_certificate_year: number | null; common_spaces: string[];
    }>(
      `select label, completed_year, building_type, floors, staircases, elevators, floor_area_m2::text, apartment_area_m2::text, volume_m3::text,
              construction_material, roof_type, roof_material, heating, heating_type, heat_distribution, cooling, ventilation, antenna, antenna_provider,
              broadband, broadband_provider, energy_class, energy_certificate_year, common_spaces
         from er_buildings where company_id = $1 order by label nulls first`,
      [companyId],
    ),
    tx.query<{ kind: string; area_m2: string | null; share_count: number; company_possession: boolean }>(
      "select kind, area_m2::text, share_count, company_possession from er_share_groups where company_id = $1 and removed_on is null",
      [companyId],
    ),
    tx.query<ChargeBasisInput & { vat_percent: string }>(
      `select charge_type, label, basis, unit_price::text, applies_to_kinds, vat_percent::text from er_charge_bases
        where company_id = $1 and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
        order by charge_type, starts_on desc`,
      [companyId],
    ),
    tx.query<LoanInput>(
      `select name, lender, loan_type, principal_eur::text, balance_eur::text, balance_date::text, drawn_on::text, due_on::text, reference_rate,
              margin_percent::text, interest_percent::text, interest_terms, undrawn_eur::text, undrawn_estimated_on::text, purpose, allocated
         from er_loans where company_id = $1 order by drawn_on nulls last, name`,
      [companyId],
    ),
    tx.query<{ loan_name: string; remaining_eur: string; balance_date: string }>(
      `select l.name as loan_name, s.remaining_eur::text, s.balance_date::text
         from er_loan_shares s join er_loans l on l.id = s.loan_id
        where s.share_group_id = $1 and s.paid_off_on is null and s.remaining_eur > 0 order by l.name`,
      [shareGroupId],
    ),
    // Korjaushistoria kokonaan: yhtiön työt ja tämän huoneiston työt.
    tx.query<{ completed_year: number | null; project: string; work_type: string; performed_by: string }>(
      `select completed_year, project, work_type, performed_by from er_maintenance_works
        where company_id = $1 and (share_group_id is null or share_group_id = $2)
        order by completed_year desc nulls last, created_at desc`,
      [companyId, shareGroupId],
    ),
    tx.query<{ planned_year: number; target: string; action: string; estimate_eur: string | null; status: string }>(
      `select planned_year, target, action, estimate_eur::text, status from er_maintenance_needs
        where company_id = $1 and status not in ('done', 'cancelled', 'decided', 'in_progress')
          and planned_year between extract(year from current_date)::int and extract(year from current_date)::int + 5
        order by planned_year, target`,
      [companyId],
    ),
    tx.query<{ planned_year: number; target: string; action: string; estimate_eur: string | null; status: string; decided_on: string | null }>(
      `select planned_year, target, action, estimate_eur::text, status, decided_on::text from er_maintenance_needs
        where company_id = $1 and status in ('decided', 'in_progress')
        order by case status when 'in_progress' then 0 else 1 end, planned_year, target`,
      [companyId],
    ),
    tx.query<{ work_type: string | null; created_at: string; status: string; completed_on: string | null; decided_on: string | null }>(
      // Työlajit ilmoituksen työriveiltä (0093); vanha sarake vain varalle.
      `select coalesce((select string_agg(distinct w.work_type, ', ') from er_renovation_notice_works w where w.notice_id = n.id), n.work_type) as work_type,
              n.created_at::text, n.status, n.completed_on::text, n.decided_on::text
         from er_renovation_notices n
        where n.share_group_id = $1 and n.status <> 'cancelled' order by n.created_at desc`,
      [shareGroupId],
    ),
    tx.query<{ amount_eur: string; holder: string | null; registered_on: string | null; property_code: string | null }>(
      `select m.amount_eur::text, m.holder, m.registered_on::text, p.property_code
         from er_property_mortgages m left join er_properties p on p.id = m.property_id
        where m.company_id = $1 order by m.registered_on nulls last, m.created_at`,
      [companyId],
    ),
    tx.query<{ insurance_type: string; name: string | null; insurer: string | null; description: string | null }>(
      "select insurance_type, name, insurer, description from er_company_insurances where company_id = $1 order by created_at",
      [companyId],
    ),
    tx.query<{ name: string }>(
      `select p.display_name as name from er_board_memberships b join er_parties p on p.id = b.party_id
        where b.company_id = $1 and b.role = 'chair' and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
        order by b.starts_on desc limit 1`,
      [companyId],
    ),
    findAttachmentCandidates(tx, companyId, shareGroupId),
  ]);

  const paymentStatus = await readPaymentStatus(tx, shareGroupId);
  const { charges, totalEur } = computeMonthlyCharges(bases, group);
  const contact = company.org_settings?.contact ?? {};
  const summary = buildingSummary(buildings);
  const spaces = spacesByKind(groups);
  const sharesApartments = groups.filter((g) => g.kind === "apartment").reduce((s, g) => s + g.share_count, 0);
  const sharesOther = groups.filter((g) => g.kind !== "apartment").reduce((s, g) => s + g.share_count, 0);
  const parkingUnits = spaces.filter((s) => s.kind === "parking" || s.kind === "garage").reduce((s, r) => s + r.count, 0);
  const parkingBuilt = properties.reduce((s, p) => s + (p.parking_spaces_built ?? 0), 0);
  const mortgagesSum = mortgages.reduce((s, m) => s + Number(m.amount_eur), 0);
  const loanRows = loans.filter((l) => l.loan_type !== "credit_limit").map(loanRow);
  const creditLimits = loans.filter((l) => l.loan_type === "credit_limit").map(loanRow);
  const htjTransferred = company.htj_register_transferred_on ? ` ${formatDate(company.htj_register_transferred_on)}` : "";
  const energyFacts = buildings
    .filter((b) => b.energy_class || b.energy_certificate_year)
    .map((b) => `${b.label ? `Rakennus ${b.label}: ` : ""}energialuokka ${b.energy_class ?? "–"}${b.energy_certificate_year ? `, todistus ${b.energy_certificate_year}` : ""}`);
  const energyDoc = candidates.find((c) => c.key === "energy_certificate")?.document;
  const withAttachments = opts.order?.withAttachments ?? false;

  const insuranceRows = insurances.length
    ? insurances.map((i) => ({ type: i.insurance_type, name: i.name ?? "–", insurer: i.insurer ?? "–", description: i.description ?? "" }))
    : company.insurance_company || company.insurance_type
      ? [{ type: company.insurance_type ?? "Vakuutus", name: "–", insurer: company.insurance_company ?? "–", description: "" }]
      : [];

  return {
    approved: CERTIFICATE_TEMPLATE_APPROVED,
    organizationName: company.org_name,
    issuedOn: opts.issuedOn ?? isoDateHelsinki(),
    verifyUrl: VERIFY_URL,
    legalBasis: LEGAL_BASIS,
    order: {
      purpose: purposeText(opts.order?.purpose ?? null, opts.order?.purposeText ?? null),
      ordererName: opts.order?.ordererName ?? null,
      withAttachments,
    },
    company: {
      name: company.name,
      businessId: company.business_id,
      registeredOn: company.registered_on,
      address: joinAddress(company.street_address, company.postal_code, company.city),
      articlesDate: company.articles_date,
      commercialRegisterNote: company.commercial_register_note,
      htjSynced: !!company.htj_synced_at || !!company.htj_register_transferred_on,
      htjTransferredOn: company.htj_register_transferred_on,
      boardChair: chair[0]?.name ?? null,
      propertyMaintenance: company.property_maintenance,
      totalShares: company.total_shares,
      sharesApartments,
      sharesOther,
      vat: company.vat_registered === null ? "Ei tiedossa" : [company.vat_registered ? "Kyllä" : "Ei", company.vat_note].filter(Boolean).join(", "),
      chargesDecidedBy: company.charges_decided_by,
      articlesMaintenanceClause: company.articles_maintenance_clause,
      shareIssueAuthorization: company.share_issue_authorization,
      articlesLawsuit: company.articles_lawsuit,
      notes: company.certificate_notes,
      shareCertificates: company.htj_synced_at || company.htj_register_transferred_on
        ? `Osakeluettelo on siirretty huoneistotietojärjestelmään${htjTransferred}. Paperiset osakekirjat mitätöidään, kun omistus kirjataan huoneistotietojärjestelmään.`
        : "Osakeluetteloa ei ole merkitty siirretyksi huoneistotietojärjestelmään. Tieto osakekirjoista tarkistetaan isännöitsijältä.",
      energy: energyFacts.length
        ? `${energyFacts.join("; ")}.${energyDoc ? "" : " Energiatodistusta ei ole tallennettu asiakirjoihin."}`
        : energyDoc
          ? `Energiatodistus: ${energyDoc.title}.`
          : "Yhtiön rakennuksille laadittua energiatodistusta ei ole kirjattu.",
    },
    manager: {
      name: company.manager_name,
      email: company.manager_email,
      phone: company.manager_phone,
      office: company.org_name,
      officeAddress: joinAddress(contact.street_address, contact.postal_code, contact.city),
      officePhone: contact.phone ?? null,
    },
    properties: properties.map((p) => {
      const parts = parsePropertyCode(p.property_code);
      const rights = p.building_rights_m2 === null ? null : Number(p.building_rights_m2);
      const unused = p.unused_building_rights_m2 === null ? null : Number(p.unused_building_rights_m2);
      return {
        code: p.property_code,
        parts: parts ? `kunta ${parts.municipality}, kaupunginosa/kylä ${parts.area}, kortteli/talo ${parts.group}, tontti/tila ${parts.unit}` : null,
        area: p.area_m2 ? formatArea(p.area_m2) : "–",
        tenure: p.tenure === "own" ? "Oma" : p.tenure === "lease" ? "Vuokra" : "–",
        lease:
          p.tenure === "lease"
            ? [p.lessor, p.lease_ends_on ? `päättyy ${formatDate(p.lease_ends_on)}` : null, p.annual_rent_eur ? `vuosivuokra ${formatEuro(p.annual_rent_eur)}` : null, p.rent_review_basis ? `tarkistus: ${p.rent_review_basis}` : null]
                .filter(Boolean)
                .join(", ") || null
            : null,
        buildingRights:
          rights === null && unused === null
            ? null
            : `myönnetty ${rights === null ? "–" : `${formatInteger(rights)} k-m²`}, käytetty ${rights !== null && unused !== null ? `${formatInteger(rights - unused)} k-m²` : "–"}, käyttämätön ${unused === null ? "–" : `${formatInteger(unused)} k-m²`}`,
      };
    }),
    buildingSummary: {
      count: String(summary.count),
      apartmentArea: summary.apartmentAreaM2 === null ? "–" : formatArea(summary.apartmentAreaM2),
      floorArea: summary.floorAreaM2 === null ? "–" : formatArea(summary.floorAreaM2),
      volume: summary.volumeM3 === null ? "–" : `${formatInteger(summary.volumeM3)} m³`,
      staircases: summary.staircases === null ? "–" : String(summary.staircases),
      elevators: String(summary.elevators),
    },
    buildings: buildings.map((b) => ({
      label: b.label,
      completedYear: b.completed_year,
      buildingType: b.building_type,
      floors: b.floors,
      material: b.construction_material,
      roof: [b.roof_type, b.roof_material].filter(Boolean).join(", ") || null,
      heating: b.heating ?? (b.heating_type ? HEATING_TYPE_LABEL[b.heating_type as HeatingType] : null),
      heatDistribution: b.heat_distribution,
      cooling: b.cooling,
      ventilation: b.ventilation,
      telecom: [b.antenna ? `antenni: ${[b.antenna, b.antenna_provider].filter(Boolean).join(", ")}` : null, b.broadband ? `laajakaista: ${[b.broadband, b.broadband_provider].filter(Boolean).join(", ")}` : null]
        .filter(Boolean)
        .join("; ") || null,
      elevators: b.elevators,
      energy: [b.energy_class, b.energy_certificate_year].filter(Boolean).join(" / ") || null,
      commonSpaces: b.common_spaces ?? [],
    })),
    spaces: spaces.map((s) => ({ label: s.label, count: String(s.count), area: s.areaM2 ? formatArea(s.areaM2) : "–", shares: formatInteger(s.shares), companyPossession: String(s.companyPossession) })),
    parking: {
      built: parkingUnits || parkingBuilt ? String(Math.max(parkingUnits, parkingBuilt)) : null,
      hall: company.parking_hall_spaces,
      other: company.parking_other_spaces,
      company: company.parking_company_spaces,
      rules: company.parking_allocation_rules,
    },
    asbestosNote: asbestosNote(buildings),
    unit: {
      label: group.unit_label,
      kindLabel: SHARE_GROUP_KIND[group.kind] ?? group.kind,
      shareRanges: formatShareRanges(group.ranges),
      shareCount: group.share_count,
      votes: group.votes,
      areaM2: group.area_m2,
      areaVerified: yesNo(group.area_verified),
      layout: group.layout,
      floor: group.floor,
      staircase: group.staircase,
      intendedUse: group.intended_use,
      building: group.building_label,
      address: group.street_address,
      htjId: group.htj_id,
      notes: group.certificate_notes,
    },
    possession: {
      companyPossession: group.company_possession
        ? `Kyllä, yhtiökokouksen päätös ${formatDate(group.company_possession_decided_on)}${group.company_possession_ends_on ? `, hallinta päättyy ${formatDate(group.company_possession_ends_on)}` : ""}`
        : "Ei",
      companyRented: group.company_possession ? yesNo(group.company_rented) : "Ei",
      widowRight: yesNo(group.widow_right),
      spousesCommonHome: group.spouses_common_home ? SPOUSES_HOME_LABEL[group.spouses_common_home] : "Ei tiedossa",
      otherRestrictions: group.other_restrictions,
      shortTermRental: group.short_term_rental ? "Yhtiön tietojen mukaan huoneistossa harjoitetaan lyhytvuokrausta." : "Yhtiön tiedossa ei ole, että huoneistossa harjoitettaisiin lyhytvuokrausta.",
    },
    renovationNotices: notices.map((n) => ({
      received: formatDate(n.created_at.slice(0, 10)),
      work: n.work_type ?? "Muutostyö",
      status: RENOVATION_STATUS_LABEL[n.status as RenovationStatus] ?? n.status,
      completed: formatDate(n.completed_on),
    })),
    renovationNoticesSince: company.management_started_on,
    finance: {
      charges: charges.map((c) => ({ label: c.label, basis: c.basisText, monthly: c.monthlyEur === null ? "–" : formatEuro(c.monthlyEur) })),
      monthlyTotal: charges.some((c) => c.monthlyEur !== null) ? formatEuro(totalEur) : null,
      priceList: chargePriceList(bases),
      loans: loanRows,
      creditLimits,
      loanShare: loanShares.map((s) => ({ loanName: s.loan_name, remaining: formatEuro(s.remaining_eur), balanceDate: s.balance_date })),
      paymentStatus,
      mortgages: mortgages.map((m) => ({ amount: formatEuro(m.amount_eur), holder: m.holder ?? "–", registeredOn: formatDate(m.registered_on), property: m.property_code ?? "–" })),
      mortgagesTotal: mortgages.length ? formatEuro(mortgagesSum) : company.mortgages_total_eur !== null ? formatEuro(company.mortgages_total_eur) : null,
      insurances: insuranceRows,
    },
    repairs: {
      needsReportOn: company.maintenance_needs_report_on,
      planOn: company.maintenance_plan_on,
      planSummary: company.maintenance_plan_summary,
      decided: decided.map((n) => ({
        status: NEED_STATUS_LABEL[n.status as NeedStatus] ?? n.status,
        target: n.target,
        action: n.action,
        decidedOn: formatDate(n.decided_on),
        year: String(n.planned_year),
        estimate: n.estimate_eur ? formatEuro(n.estimate_eur) : "–",
      })),
      done: works.map((w) => ({ year: w.completed_year ? String(w.completed_year) : "–", project: w.project, workType: w.work_type, by: w.performed_by === "shareholder" ? "Osakas" : "Yhtiö" })),
      planned: needs.map((n) => ({ year: String(n.planned_year), target: n.target, action: n.action, estimate: n.estimate_eur ? formatEuro(n.estimate_eur) : "–" })),
    },
    restrictions: REDEMPTION_CLAUSE.filter((r) => company.redemption_clause?.[r.key]).map((r) => r.label),
    attachments: opts.attachments ?? availabilityEntries(candidates),
  };
}

export async function renderManagerCertificate(data: ManagerCertificateData): Promise<RenderedDocument> {
  return renderDocumentPdf(createElement(ManagerCertificate, { data }));
}
