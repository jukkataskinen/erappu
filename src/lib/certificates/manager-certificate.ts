import { createElement } from "react";
import type { Sql } from "@/lib/db";
import { isoDateHelsinki } from "@/lib/format";
import { REDEMPTION_CLAUSE, SHARE_GROUP_KIND } from "@/lib/registry/labels";
import { ManagerCertificate, type ManagerCertificateData } from "@/documents/ManagerCertificate";
import { renderDocumentPdf, type RenderedDocument } from "@/documents/render";
import { formatArea, formatEuro, formatShareRanges } from "@/documents/format";
import { computeMonthlyCharges, type ChargeBasisInput } from "./charges";
import { CERTIFICATE_TEMPLATE_APPROVED } from "./pricing";

/**
 * Isännöitsijäntodistuksen tiedot (VNa 365/2010 -rakenne, luonnos).
 *
 * Yhtiön tiedot, rakennukset, vastikkeet, lainat ja korjaukset eRapun
 * rekisteristä; omistajat ja panttaukset HTJ:stä (merkintä todistuksessa).
 * Luetaan kutsujan transaktiossa (henkilökunnan RLS).
 */

/** TODO(eSinetti): korvataan eSinetin julkisella /verify-osoitteella, kun todistus sinetöidään. */
export const VERIFY_URL_PLACEHOLDER = "https://app.esinetti.fi/verify";

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
  const [y, m, d] = row.as_of.split("-");
  const dateText = ` (tilanne ${Number(d)}.${Number(m)}.${y})`;
  return Number(row.overdue_eur) > 0 ? `Erääntyneitä maksuja ${formatEuro(Number(row.overdue_eur))}${dateText}.` : `Ei erääntyneitä maksuja${dateText}.`;
}

export async function loadManagerCertificateData(tx: Sql, shareGroupId: string, opts: { issuedOn?: string } = {}): Promise<ManagerCertificateData | null> {
  const [group] = await tx.query<{
    id: string; company_id: string; unit_label: string; kind: string; layout: string | null; floor: string | null; area_m2: string | null;
    intended_use: string | null; share_count: number; building_label: string | null; ranges: { first: number; last: number }[];
  }>(
    `select g.id, g.company_id, g.unit_label, g.kind, g.layout, g.floor, g.area_m2, g.intended_use, g.share_count, b.label as building_label,
            coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                        from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
       from er_share_groups g left join er_buildings b on b.id = g.building_id
      where g.id = $1`,
    [shareGroupId],
  );
  if (!group) return null;

  const [company] = await tx.query<{
    name: string; business_id: string; street_address: string | null; postal_code: string | null; city: string | null; articles_date: string | null;
    total_shares: number | null; insurance_company: string | null; insurance_type: string | null; property_maintenance: string | null;
    redemption_clause: Record<string, boolean>; htj_synced_at: string | null; org_name: string;
    manager_name: string | null; manager_email: string | null; manager_phone: string | null;
  }>(
    `select c.name, c.business_id, c.street_address, c.postal_code, c.city, to_char(c.articles_date, 'YYYY-MM-DD') as articles_date, c.total_shares,
            c.insurance_company, c.insurance_type, c.property_maintenance, c.redemption_clause, c.htj_synced_at, o.name as org_name,
            coalesce(u.full_name, u.email) as manager_name, u.email as manager_email, u.phone as manager_phone
       from er_housing_companies c join er_organizations o on o.id = c.organization_id left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [group.company_id],
  );
  if (!company) return null;

  const [properties, buildings, units, bases, loans, loanShares, works, needs] = await Promise.all([
    tx.query<{ property_code: string; tenure: string | null; area_m2: string | null; lessor: string | null; lease_ends_on: string | null; parking_spaces_built: number | null }>(
      "select property_code, tenure, area_m2, lessor, to_char(lease_ends_on, 'YYYY-MM-DD') as lease_ends_on, parking_spaces_built from er_properties where company_id = $1 order by property_code",
      [group.company_id],
    ),
    tx.query<{
      label: string | null; completed_year: number | null; building_type: string | null; floors: number | null; construction_material: string | null;
      roof_type: string | null; roof_material: string | null; heating: string | null; ventilation: string | null; energy_class: string | null;
      energy_certificate_year: number | null; common_spaces: string[];
    }>("select * from er_buildings where company_id = $1 order by label nulls first", [group.company_id]),
    tx.query<{ kind: string; count: number; area: string | null }>(
      "select kind, count(*)::int as count, sum(area_m2)::text as area from er_share_groups where company_id = $1 and removed_on is null group by kind",
      [group.company_id],
    ),
    tx.query<ChargeBasisInput>(
      `select charge_type, label, basis, unit_price, applies_to_kinds from er_charge_bases
        where company_id = $1 and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
        order by charge_type, starts_on desc`,
      [group.company_id],
    ),
    tx.query<{ name: string; lender: string | null; balance_eur: string | null; principal_eur: string; due_on: string | null }>(
      "select name, lender, balance_eur, principal_eur, to_char(due_on, 'YYYY-MM-DD') as due_on from er_loans where company_id = $1 order by name",
      [group.company_id],
    ),
    tx.query<{ loan_name: string; remaining_eur: string; balance_date: string }>(
      `select l.name as loan_name, s.remaining_eur, to_char(s.balance_date, 'YYYY-MM-DD') as balance_date
         from er_loan_shares s join er_loans l on l.id = s.loan_id
        where s.share_group_id = $1 and s.paid_off_on is null and s.remaining_eur > 0 order by l.name`,
      [shareGroupId],
    ),
    tx.query<{ completed_year: number | null; project: string; work_type: string }>(
      `select completed_year, project, work_type from er_maintenance_works
        where company_id = $1 and (share_group_id is null or share_group_id = $2)
          and coalesce(completed_year, extract(year from completed_on)::int, extract(year from current_date)::int) >= extract(year from current_date)::int - 10
        order by completed_year desc nulls last`,
      [group.company_id, shareGroupId],
    ),
    tx.query<{ planned_year: number; target: string; action: string }>(
      `select planned_year, target, action from er_maintenance_needs
        where company_id = $1 and status not in ('done', 'cancelled')
          and planned_year between extract(year from current_date)::int and extract(year from current_date)::int + 5
        order by planned_year, target`,
      [group.company_id],
    ),
  ]);

  const paymentStatus = await readPaymentStatus(tx, shareGroupId);
  const { charges, totalEur } = computeMonthlyCharges(bases, group);
  // Samaa vastiketyyppiä voi olla useampi voimassa oleva rivi vain virheellisesti; näytetään ne silti, jotta virhe näkyy.
  const unitsBy = new Map(units.map((u) => [u.kind, u]));
  const parkingUnits = (unitsBy.get("parking")?.count ?? 0) + (unitsBy.get("garage")?.count ?? 0);
  const parkingBuilt = properties.reduce((s, p) => s + (p.parking_spaces_built ?? 0), 0);
  const firstProperty = properties[0];

  return {
    approved: CERTIFICATE_TEMPLATE_APPROVED,
    organizationName: company.org_name,
    issuedOn: opts.issuedOn ?? isoDateHelsinki(),
    verifyUrl: VERIFY_URL_PLACEHOLDER,
    company: {
      name: company.name,
      businessId: company.business_id,
      address: [company.street_address, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
      propertyCodes: properties.map((p) => p.property_code),
      articlesDate: company.articles_date,
      tenure: firstProperty?.tenure ?? null,
      lessor: firstProperty?.lessor ?? null,
      leaseEndsOn: firstProperty?.lease_ends_on ?? null,
      propertyArea: firstProperty?.area_m2 ? formatArea(firstProperty.area_m2) : null,
      insurance: [company.insurance_company, company.insurance_type].filter(Boolean).join(", ") || null,
      propertyMaintenance: company.property_maintenance,
      apartmentCount: unitsBy.get("apartment")?.count ?? 0,
      commercialCount: unitsBy.get("commercial")?.count ?? 0,
      apartmentAreaM2: Number(unitsBy.get("apartment")?.area ?? 0),
      commercialAreaM2: Number(unitsBy.get("commercial")?.area ?? 0),
      parkingSpaces: parkingUnits || parkingBuilt ? `${Math.max(parkingUnits, parkingBuilt)} kpl` : null,
      totalShares: company.total_shares,
      htjSynced: !!company.htj_synced_at,
      commonSpaces: [...new Set(buildings.flatMap((b) => b.common_spaces ?? []))],
    },
    buildings: buildings.map((b) => ({
      label: b.label,
      completedYear: b.completed_year,
      buildingType: b.building_type,
      floors: b.floors,
      material: b.construction_material,
      roof: [b.roof_type, b.roof_material].filter(Boolean).join(", ") || null,
      heating: b.heating,
      ventilation: b.ventilation,
      energy: [b.energy_class, b.energy_certificate_year].filter(Boolean).join(" / ") || null,
    })),
    unit: {
      label: group.unit_label,
      kindLabel: SHARE_GROUP_KIND[group.kind] ?? group.kind,
      shareRanges: formatShareRanges(group.ranges),
      shareCount: group.share_count,
      areaM2: group.area_m2,
      layout: group.layout,
      floor: group.floor,
      intendedUse: group.intended_use,
      building: group.building_label,
    },
    finance: {
      charges: charges.map((c) => ({ label: c.label, basis: c.basisText, monthly: c.monthlyEur === null ? "–" : formatEuro(c.monthlyEur) })),
      monthlyTotal: charges.some((c) => c.monthlyEur !== null) ? formatEuro(totalEur) : null,
      loans: loans.map((l) => ({ name: l.name, lender: l.lender, balance: formatEuro(l.balance_eur ?? l.principal_eur), dueOn: l.due_on })),
      loanShare: loanShares.map((s) => ({ loanName: s.loan_name, remaining: formatEuro(s.remaining_eur), balanceDate: s.balance_date })),
      paymentStatus,
    },
    repairs: {
      done: works.map((w) => ({ year: w.completed_year ? String(w.completed_year) : "–", project: w.project, workType: w.work_type })),
      planned: needs.map((n) => ({ year: String(n.planned_year), target: n.target, action: n.action })),
    },
    restrictions: REDEMPTION_CLAUSE.filter((r) => company.redemption_clause?.[r.key]).map((r) => r.label),
    manager: { name: company.manager_name, email: company.manager_email, phone: company.manager_phone },
  };
}

export async function renderManagerCertificate(data: ManagerCertificateData): Promise<RenderedDocument> {
  return renderDocumentPdf(createElement(ManagerCertificate, { data }));
}
