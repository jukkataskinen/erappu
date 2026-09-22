"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BOARD_MINUTES_SIGNERS } from "@/lib/meetings/minutes-signers";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, isExclusionViolation, isUniqueViolation, parseForm } from "@/lib/forms";
import { parseShareRanges } from "@/lib/registry/share-ranges";
import { syncPortalAccessForBoard, syncPortalAccessForGroup } from "@/lib/registry/portal-access";
import { isValidBusinessId, isValidPostalCode, normalizeBusinessId } from "@/lib/validation/finnish";
import { REDEMPTION_CLAUSE } from "@/lib/registry/labels";
import { HEATING_TYPE_LABEL, HEATING_TYPES, type HeatingType } from "@/lib/consumption/heating";

const uuid = z.string().uuid();
const optText = z.preprocess(emptyToNull, z.string().max(500).nullable());
const optInt = z.preprocess(emptyToNull, z.coerce.number().int().min(0).nullable());
const optNum = z.preprocess((v) => (typeof v === "string" ? emptyToNull(v.replace(",", ".")) : v), z.coerce.number().min(0).nullable());
const optDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

async function staffWriter() {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail("/taloyhtiot", "Roolillasi ei voi muokata rekisteriä.");
  return ctx;
}

const companySchema = z.object({
  name: z.string().min(2, "Anna yhtiön nimi.").max(200),
  business_id: z.string().transform(normalizeBusinessId).refine(isValidBusinessId, "Y-tunnus ei ole kelvollinen."),
  company_form: z.enum(["asunto_oy", "koy", "other"]),
  street_address: optText,
  postal_code: z.preprocess(emptyToNull, z.string().refine(isValidPostalCode, "Postinumerossa on 5 numeroa.").nullable()),
  city: optText,
  articles_date: optDate,
  fiscal_year_start: z.string().regex(/^\d{2}-\d{2}$/, "Tilikauden alku muodossa KK-PP.").default("01-01"),
  total_shares: optInt,
  manager_user_id: z.preprocess(emptyToNull, uuid.nullable()),
  management_started_on: optDate,
  same_charge_basis: z.preprocess((v) => v === "on", z.boolean()),
  property_maintenance: optText,
  commercial_register_note: optText,
  registered_on: optDate,
  certificate_notes: z.preprocess(emptyToNull, z.string().max(4000).nullable()),
  htj_register_transferred_on: optDate,
  vat_registered: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable()),
  vat_note: optText,
  charges_decided_by: optText,
  articles_maintenance_clause: optText,
  share_issue_authorization: optText,
  articles_lawsuit: optText,
  parking_hall_spaces: optInt,
  parking_other_spaces: optInt,
  parking_company_spaces: optInt,
  parking_allocation_rules: z.preprocess(emptyToNull, z.string().max(2000).nullable()),
  board_minutes_signers: z.preprocess(emptyToNull, z.enum(BOARD_MINUTES_SIGNERS).nullable()),
});

type CompanyInput = z.infer<typeof companySchema>;

/**
 * Lomakkeen sarakkeet järjestyksessä. Vakuutussarakkeita (insurance_company,
 * insurance_type) ei enää kirjoiteta: vakuutukset ovat luettelona
 * er_company_insurances-taulussa (0091), ja vanha arvo jää talteen.
 */
const COMPANY_COLUMNS = [
  "name", "business_id", "company_form", "street_address", "postal_code", "city", "articles_date", "fiscal_year_start", "total_shares",
  "manager_user_id", "management_started_on", "same_charge_basis", "property_maintenance", "commercial_register_note", "registered_on",
  "certificate_notes", "htj_register_transferred_on", "vat_registered", "vat_note", "charges_decided_by", "articles_maintenance_clause",
  "share_issue_authorization", "articles_lawsuit", "parking_hall_spaces", "parking_other_spaces", "parking_company_spaces", "parking_allocation_rules",
  "board_minutes_signers",
] as const satisfies readonly (keyof CompanyInput)[];

function redemptionFrom(formData: FormData) {
  return Object.fromEntries(REDEMPTION_CLAUSE.map((r) => [r.key, formData.get(`rc_${r.key}`) === "on"]));
}

export async function createCompany(formData: FormData) {
  const ctx = await staffWriter();
  const data = parseForm(companySchema, formData, "/taloyhtiot/uusi");
  let id: string;
  try {
    id = await ctx.run(async (tx) => {
      const values = COMPANY_COLUMNS.map((c) => (c === "manager_user_id" ? data.manager_user_id ?? ctx.user.id : data[c]));
      const [row] = await tx.query<{ id: string }>(
        `insert into er_housing_companies (organization_id, ${COMPANY_COLUMNS.join(", ")}, redemption_clause)
         values (${[ctx.org.organizationId, ...values, null].map((_, i) => `$${i + 1}`).join(",")}) returning id`,
        [ctx.org.organizationId, ...values, JSON.stringify(redemptionFrom(formData))],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "create", entity: "housing_company", entityId: row.id });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail("/taloyhtiot/uusi", "Yhtiö tällä Y-tunnuksella on jo rekisterissä.");
    throw err;
  }
  revalidatePath("/taloyhtiot");
  redirect(`/taloyhtiot/${id}`);
}

export async function updateCompany(formData: FormData) {
  const ctx = await staffWriter();
  const id = uuid.parse(formData.get("id"));
  const back = `/taloyhtiot/${id}/muokkaa`;
  const data = parseForm(companySchema, formData, back);
  try {
    const rows = await ctx.run(async (tx) => {
      const sets = COMPANY_COLUMNS.map((c, i) => `${c}=$${i + 2}`).join(", ");
      const r = await tx.query(
        `update er_housing_companies set ${sets}, redemption_clause=$${COMPANY_COLUMNS.length + 2} where id=$1 returning id`,
        [id, ...COMPANY_COLUMNS.map((c) => data[c]), JSON.stringify(redemptionFrom(formData))],
      );
      if (r.length) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "housing_company", entityId: id });
      return r;
    });
    if (rows.length === 0) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Toinen yhtiö käyttää jo tätä Y-tunnusta.");
    throw err;
  }
  revalidatePath(`/taloyhtiot/${id}`);
  redirect(`/taloyhtiot/${id}/perustiedot`);
}

const shareGroupSchema = z.object({
  company_id: uuid,
  unit_label: z.string().min(1, "Anna huoneiston tunnus.").max(30),
  kind: z.enum(["apartment", "commercial", "parking", "garage", "storage", "other"]),
  layout: optText,
  floor: optText,
  area_m2: optNum,
  intended_use: optText,
  building_id: z.preprocess(emptyToNull, uuid.nullable()),
  ranges: z.string().max(500).default(""),
  is_rented: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveShareGroup(formData: FormData) {
  const ctx = await staffWriter();
  const groupId = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const companyId = uuid.parse(formData.get("company_id"));
  const back = groupId ? `/taloyhtiot/${companyId}/huoneistot/${groupId}` : `/taloyhtiot/${companyId}/huoneistot/uusi`;
  const data = parseForm(shareGroupSchema, formData, back);
  const parsed = parseShareRanges(data.ranges);
  if (parsed.errors.length) fail(back, parsed.errors[0]);

  let id: string;
  try {
    id = await ctx.run(async (tx) => {
      const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
      if (!company) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
      let gid = groupId;
      if (gid) {
        const r = await tx.query(
          `update er_share_groups set unit_label=$2, kind=$3, layout=$4, floor=$5, area_m2=$6, intended_use=$7, building_id=$8, is_rented=$9
            where id=$1 and company_id=$10 and source <> 'htj' returning id`,
          [gid, data.unit_label, data.kind, data.layout, data.floor, data.area_m2, data.intended_use, data.building_id, data.is_rented, companyId],
        );
        if (r.length === 0) fail(back, "HTJ:stä tulleita osakeryhmiä ei muokata käsin.");
        await tx.query("delete from er_share_ranges where share_group_id = $1", [gid]);
      } else {
        const [row] = await tx.query<{ id: string }>(
          `insert into er_share_groups (organization_id, company_id, unit_label, kind, layout, floor, area_m2, intended_use, building_id, is_rented)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [company.organization_id, companyId, data.unit_label, data.kind, data.layout, data.floor, data.area_m2, data.intended_use, data.building_id, data.is_rented],
        );
        gid = row.id;
      }
      for (const r of parsed.ranges) {
        await tx.query(
          "insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)",
          [company.organization_id, companyId, gid, r.first, r.last],
        );
      }
      await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: groupId ? "update" : "create", entity: "share_group", entityId: gid });
      return gid!;
    });
  } catch (err) {
    if (isExclusionViolation(err)) fail(back, "Osakenumerot menevät päällekkäin toisen huoneiston kanssa.");
    if (isUniqueViolation(err)) fail(back, "Yhtiössä on jo huoneisto tällä tunnuksella.");
    throw err;
  }
  revalidatePath(`/taloyhtiot/${companyId}/huoneistot`);
  redirect(`/taloyhtiot/${companyId}/huoneistot/${id}`);
}

// ---------------------------------------------------------------------------
// Vakuutukset (er_company_insurances)
// ---------------------------------------------------------------------------
const insuranceSchema = z.object({
  insurance_type: z.string().min(2, "Anna vakuutuksen tyyppi.").max(200),
  name: optText,
  insurer: optText,
  description: z.preprocess(emptyToNull, z.string().max(2000).nullable()),
});

export async function addInsurance(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/perustiedot`;
  const d = parseForm(insuranceSchema, formData, back);
  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
    if (!company) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
    const [row] = await tx.query<{ id: string }>(
      "insert into er_company_insurances (organization_id, company_id, insurance_type, name, insurer, description) values ($1,$2,$3,$4,$5,$6) returning id",
      [company.organization_id, companyId, d.insurance_type, d.name, d.insurer, d.description],
    );
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create", entity: "company_insurance", entityId: row.id });
  });
  revalidatePath(back);
  redirect(back);
}

export async function deleteInsurance(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const id = uuid.parse(formData.get("id"));
  const back = `/taloyhtiot/${companyId}/perustiedot`;
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>("delete from er_company_insurances where id = $1 and company_id = $2 returning organization_id", [id, companyId]);
    if (rows[0]) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete", entity: "company_insurance", entityId: id });
  });
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Kiinteistöt (tontti)
// ---------------------------------------------------------------------------
const propertySchema = z.object({
  property_code: z.string().regex(/^\d{1,3}-\d{1,3}-\d{1,4}-\d{1,4}(-[A-Za-z0-9]+)?$/, "Kiinteistötunnus muodossa 179-15-1508-9.").max(40),
  tenure: z.preprocess(emptyToNull, z.enum(["own", "lease"]).nullable()),
  area_m2: optNum,
  lessor: optText,
  lease_ends_on: optDate,
  annual_rent_eur: optNum,
  rent_review_basis: optText,
  building_rights_m2: optNum,
  unused_building_rights_m2: optNum,
  parking_spaces_planned: optInt,
  parking_spaces_built: optInt,
});

const PROPERTY_COLUMNS = [
  "property_code", "tenure", "area_m2", "lessor", "lease_ends_on", "annual_rent_eur", "rent_review_basis", "building_rights_m2",
  "unused_building_rights_m2", "parking_spaces_planned", "parking_spaces_built",
] as const;

export async function saveProperty(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const propertyId = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const back = `/taloyhtiot/${companyId}/kiinteisto`;
  const d = parseForm(propertySchema, formData, back);
  if (d.building_rights_m2 !== null && d.unused_building_rights_m2 !== null && d.unused_building_rights_m2 > d.building_rights_m2) {
    fail(back, "Käyttämätön rakennusoikeus ei voi olla suurempi kuin myönnetty.");
  }
  const values = PROPERTY_COLUMNS.map((c) => d[c]);
  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
    if (!company) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
    let id = propertyId;
    if (id) {
      const rows = await tx.query(
        `update er_properties set ${PROPERTY_COLUMNS.map((c, i) => `${c}=$${i + 3}`).join(", ")} where id = $1 and company_id = $2 returning id`,
        [id, companyId, ...values],
      );
      if (rows.length === 0) fail(back, "Kiinteistöä ei löytynyt.");
    } else {
      const [row] = await tx.query<{ id: string }>(
        `insert into er_properties (organization_id, company_id, ${PROPERTY_COLUMNS.join(", ")})
         values (${[0, 1, ...values].map((_, i) => `$${i + 1}`).join(",")}) returning id`,
        [company.organization_id, companyId, ...values],
      );
      id = row.id;
    }
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: propertyId ? "update" : "create", entity: "property", entityId: id });
  });
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Rakennuksen tietojen muokkaus
// ---------------------------------------------------------------------------
const buildingDetailSchema = buildingSchemaBase().extend({
  heat_distribution: optText,
  cooling: optText,
  broadband: optText,
  broadband_provider: optText,
  antenna_provider: optText,
});

const BUILDING_COLUMNS = [
  "label", "building_type", "completed_year", "floors", "staircases", "elevators", "floor_area_m2", "apartment_area_m2", "volume_m3",
  "construction_material", "roof_type", "roof_material", "heating", "heating_type", "heat_distribution", "cooling", "ventilation", "antenna",
  "antenna_provider", "broadband", "broadband_provider", "energy_class", "energy_certificate_year",
] as const;

export async function updateBuilding(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const buildingId = uuid.parse(formData.get("building_id"));
  const back = `/taloyhtiot/${companyId}/kiinteisto?muokkaa=${buildingId}`;
  const d = parseForm(buildingDetailSchema, formData, back);
  const spaces = d.common_spaces.split(",").map((s) => s.trim()).filter(Boolean);
  const values = BUILDING_COLUMNS.map((c) => (c === "elevators" ? d.elevators ?? 0 : d[c]));
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      `update er_buildings set ${BUILDING_COLUMNS.map((c, i) => `${c}=$${i + 3}`).join(", ")}, common_spaces=$${BUILDING_COLUMNS.length + 3}
        where id = $1 and company_id = $2 returning organization_id`,
      [buildingId, companyId, ...values, spaces],
    );
    if (rows.length === 0) fail(back, "Rakennusta ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "building", entityId: buildingId });
  });
  revalidatePath(`/taloyhtiot/${companyId}/kiinteisto`);
  redirect(`/taloyhtiot/${companyId}/kiinteisto`);
}

const triState = z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable());

const unitCertificateSchema = z.object({
  certificate_notes: z.preprocess(emptyToNull, z.string().max(4000).nullable()),
  company_possession: z.preprocess((v) => v === "on", z.boolean()),
  company_possession_decided_on: optDate,
  company_possession_ends_on: optDate,
  company_rented: z.preprocess((v) => v === "on", z.boolean()),
  widow_right: triState,
  spouses_common_home: z.preprocess(emptyToNull, z.enum(["yes", "no", "unknown"]).nullable()),
  other_restrictions: z.preprocess(emptyToNull, z.string().max(2000).nullable()),
  votes: optInt,
  area_verified: triState,
  staircase: z.preprocess(emptyToNull, z.string().max(20).nullable()),
  street_address: optText,
});

/**
 * Huoneiston isännöitsijäntodistuksen tiedot. Nämä ovat yhtiön omia tietoja
 * (hallintaan otto, lisätiedot), joten ne tallennetaan myös HTJ-peräiselle
 * osakeryhmälle, jonka perustietoja ei muuten muokata käsin.
 */
export async function saveUnitCertificateInfo(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const groupId = uuid.parse(formData.get("share_group_id"));
  const back = `/taloyhtiot/${companyId}/huoneistot/${groupId}`;
  const d = parseForm(unitCertificateSchema, formData, back);
  if (!d.company_possession && (d.company_possession_decided_on || d.company_possession_ends_on)) fail(back, "Merkitse huoneisto yhtiön hallintaan, jos annat hallinnan päivät.");
  if (d.company_possession && !d.company_possession_decided_on) fail(back, "Anna yhtiökokouksen päätöksen päivä.");
  if (d.company_possession_decided_on && d.company_possession_ends_on && d.company_possession_ends_on < d.company_possession_decided_on) fail(back, "Hallinta ei voi päättyä ennen päätöstä.");
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      `update er_share_groups set certificate_notes=$3, company_possession=$4, company_possession_decided_on=$5, company_possession_ends_on=$6,
          company_rented=$7, widow_right=$8, spouses_common_home=$9, other_restrictions=$10, votes=$11, area_verified=$12, staircase=$13, street_address=$14
        where id=$1 and company_id=$2 returning organization_id`,
      [groupId, companyId, d.certificate_notes, d.company_possession, d.company_possession_decided_on, d.company_possession_ends_on,
        d.company_possession && d.company_rented, d.widow_right, d.spouses_common_home, d.other_restrictions, d.votes, d.area_verified, d.staircase, d.street_address],
    );
    if (rows.length === 0) fail(back, "Huoneistoa ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "share_group_certificate_info", entityId: groupId });
  });
  revalidatePath(back);
  redirect(back);
}

const partySchema = z.object({
  kind: z.enum(["person", "company", "estate"]).default("person"),
  first_names: optText,
  last_name: optText,
  company_name: optText,
  email: z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").nullable()),
  phone: optText,
  street_address: optText,
  postal_code: z.preprocess(emptyToNull, z.string().refine(isValidPostalCode, "Postinumerossa on 5 numeroa.").nullable()),
  city: optText,
  electronic_notice_consent: z.preprocess((v) => v === "on", z.boolean()),
});

const ownershipSchema = partySchema.extend({
  share_group_id: uuid,
  company_id: uuid,
  share_numerator: z.coerce.number().int().min(1).default(1),
  share_denominator: z.coerce.number().int().min(1).default(1),
  starts_on: optDate,
  role: z.enum(["owner", "tenant", "other"]),
  relation: z.enum(["ownership", "residency"]),
});

/** Osakas tai asukas käsin. HTJ-yhteyden jälkeen omistajat tulevat HTJ:stä. */
export async function addPartyToShareGroup(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const groupId = uuid.parse(formData.get("share_group_id"));
  const back = `/taloyhtiot/${companyId}/huoneistot/${groupId}`;
  const data = parseForm(ownershipSchema, formData, back);
  if (data.kind === "person" && !data.last_name) fail(back, "Anna sukunimi.");
  if (data.kind !== "person" && !data.company_name) fail(back, "Anna nimi.");

  await ctx.run(async (tx) => {
    const [group] = await tx.query<{ organization_id: string }>("select organization_id from er_share_groups where id = $1 and company_id = $2", [groupId, companyId]);
    if (!group) fail("/taloyhtiot", "Huoneistoa ei löytynyt.");
    const [party] = await tx.query<{ id: string }>(
      `insert into er_parties (organization_id, kind, first_names, last_name, company_name, email, phone, street_address, postal_code, city, electronic_notice_consent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [group.organization_id, data.kind, data.first_names, data.last_name, data.company_name, data.email, data.phone, data.street_address, data.postal_code, data.city, data.electronic_notice_consent],
    );
    if (data.relation === "ownership") {
      await tx.query(
        `insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, starts_on, source)
         values ($1,$2,$3,$4,$5,$6,'manual')`,
        [group.organization_id, groupId, party.id, data.share_numerator, data.share_denominator, data.starts_on],
      );
      if (data.role === "owner") {
        await tx.query(
          "insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,'owner',$4)",
          [group.organization_id, groupId, party.id, data.starts_on],
        );
      }
    } else {
      await tx.query(
        "insert into er_residencies (organization_id, share_group_id, party_id, role, starts_on) values ($1,$2,$3,$4,$5)",
        [group.organization_id, groupId, party.id, data.role, data.starts_on],
      );
    }
    await syncPortalAccessForGroup(tx, groupId);
    await audit(tx, { organizationId: group.organization_id, userId: ctx.user.id, action: "create", entity: data.relation, entityId: groupId });
  });
  revalidatePath(back);
  redirect(back);
}

export async function endRelation(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const groupId = uuid.parse(formData.get("share_group_id"));
  const table = z.enum(["ownership", "residency"]).parse(formData.get("relation"));
  const id = uuid.parse(formData.get("id"));
  const back = `/taloyhtiot/${companyId}/huoneistot/${groupId}`;
  await ctx.run(async (tx) => {
    const t = table === "ownership" ? "er_ownerships" : "er_residencies";
    const extra = table === "ownership" ? "and source <> 'htj'" : "";
    const rows = await tx.query<{ organization_id: string }>(
      `update ${t} set ends_on = current_date where id = $1 and share_group_id = $2 and ends_on is null ${extra} returning organization_id`,
      [id, groupId],
    );
    if (rows.length === 0) fail(back, table === "ownership" ? "HTJ:stä tulleet omistukset päättyvät HTJ:n muutostiedoista." : "Riviä ei löytynyt.");
    await syncPortalAccessForGroup(tx, groupId);
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "end", entity: table, entityId: id });
  });
  revalidatePath(back);
  redirect(back);
}

const boardSchema = partySchema.extend({
  company_id: uuid,
  role: z.enum(["chair", "member", "deputy", "operations_auditor", "deputy_operations_auditor", "auditor"]),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna toimikauden alkupäivä."),
  ends_on: optDate,
  existing_party_id: z.preprocess(emptyToNull, uuid.nullable()),
});

export async function addBoardMember(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/hallitus`;
  const data = parseForm(boardSchema, formData, back);
  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
    if (!company) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
    let partyId = data.existing_party_id;
    if (!partyId) {
      if (!data.last_name) fail(back, "Valitse osakas tai anna uuden henkilön nimi.");
      const [p] = await tx.query<{ id: string }>(
        `insert into er_parties (organization_id, kind, first_names, last_name, email, phone) values ($1,'person',$2,$3,$4,$5) returning id`,
        [company.organization_id, data.first_names, data.last_name, data.email, data.phone],
      );
      partyId = p.id;
    } else if (data.email || data.phone) {
      // Valmiiksi rekisterissä olevalle osakkaalle täydennetään puuttuvat
      // yhteystiedot; olemassa olevaa arvoa ei korvata hiljaa.
      await tx.query("update er_parties set email = coalesce(email, $2), phone = coalesce(phone, $3) where id = $1", [partyId, data.email, data.phone]);
    }
    await tx.query(
      "insert into er_board_memberships (organization_id, company_id, party_id, role, starts_on, ends_on) values ($1,$2,$3,$4,$5,$6)",
      [company.organization_id, companyId, partyId, data.role, data.starts_on, data.ends_on],
    );
    await syncPortalAccessForBoard(tx, companyId);
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create", entity: "board_membership", entityId: companyId });
  });
  revalidatePath(back);
  redirect(back);
}

export async function endBoardMembership(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const id = uuid.parse(formData.get("id"));
  const back = `/taloyhtiot/${companyId}/hallitus`;
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_board_memberships set ends_on = current_date where id = $1 and company_id = $2 and (ends_on is null or ends_on > current_date) returning organization_id",
      [id, companyId],
    );
    if (rows.length) {
      await syncPortalAccessForBoard(tx, companyId);
      await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "end", entity: "board_membership", entityId: id });
    }
  });
  revalidatePath(back);
  redirect(back);
}

const buildingSchema = buildingSchemaBase();

/** Funktio eikä vakio, koska rakennuksen muokkausskeema (ylempänä tiedostossa) laajentaa tätä. */
function buildingSchemaBase() {
  return z.object({
  company_id: uuid,
  label: optText,
  building_type: optText,
  completed_year: z.preprocess(emptyToNull, z.coerce.number().int().min(1800).max(2100).nullable()),
  floors: optInt,
  staircases: optInt,
  elevators: z.preprocess(emptyToNull, z.coerce.number().int().min(0).nullable()),
  floor_area_m2: optNum,
  apartment_area_m2: optNum,
  volume_m3: optNum,
  construction_material: optText,
  roof_type: optText,
  roof_material: optText,
  heating: optText,
  heating_type: z.preprocess(emptyToNull, z.enum(HEATING_TYPES as [HeatingType, ...HeatingType[]]).nullable()),
  ventilation: optText,
  antenna: optText,
  energy_class: optText,
  energy_certificate_year: z.preprocess(emptyToNull, z.coerce.number().int().min(1990).max(2100).nullable()),
  common_spaces: z.string().default(""),
  });
}

export async function addBuilding(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const back = `/taloyhtiot/${companyId}/kiinteisto`;
  const d = parseForm(buildingSchema, formData, back);
  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId]);
    if (!company) fail("/taloyhtiot", "Yhtiötä ei löytynyt.");
    const spaces = d.common_spaces.split(",").map((s) => s.trim()).filter(Boolean);
    await tx.query(
      `insert into er_buildings (organization_id, company_id, label, building_type, completed_year, floors, staircases, elevators, floor_area_m2,
          apartment_area_m2, volume_m3, construction_material, roof_type, roof_material, heating, heating_type, ventilation, antenna, energy_class, energy_certificate_year, common_spaces)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,0),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [company.organization_id, companyId, d.label, d.building_type, d.completed_year, d.floors, d.staircases, d.elevators, d.floor_area_m2,
        d.apartment_area_m2, d.volume_m3, d.construction_material, d.roof_type, d.roof_material,
        d.heating ?? (d.heating_type ? HEATING_TYPE_LABEL[d.heating_type] : null), d.heating_type, d.ventilation, d.antenna, d.energy_class, d.energy_certificate_year, spaces],
    );
  });
  revalidatePath(back);
  redirect(back);
}

export async function updateBuildingHeating(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const buildingId = uuid.parse(formData.get("building_id"));
  const back = `/taloyhtiot/${companyId}/kiinteisto`;
  const heatingType = z.preprocess(emptyToNull, z.enum(HEATING_TYPES as [HeatingType, ...HeatingType[]]).nullable()).safeParse(formData.get("heating_type"));
  if (!heatingType.success) fail(back, "Valitse lämmitysmuoto listasta.");
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_buildings set heating_type = $3 where id = $1 and company_id = $2 returning organization_id",
      [buildingId, companyId, heatingType.data],
    );
    if (rows.length === 0) fail(back, "Rakennusta ei löytynyt.");
    await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "building_heating", entityId: buildingId, details: { heatingType: heatingType.data } });
  });
  revalidatePath(back);
  revalidatePath("/kulutus");
  redirect(back);
}

const partyContactSchema = z.object({
  company_id: uuid,
  share_group_id: uuid,
  party_id: uuid,
  email: z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(254).nullable()),
  phone: z.preprocess(emptyToNull, z.string().max(60).nullable()),
});

/**
 * Osakkaan tai asukkaan sähköposti ja puhelin huoneiston sivulta. Ilman
 * sähköpostia portaalikutsua ei voi lähettää, ja Accessista tuoduilta
 * osapuolilta osoite puuttuu lähes aina.
 */
export async function updatePartyContact(formData: FormData) {
  const ctx = await staffWriter();
  const companyId = uuid.parse(formData.get("company_id"));
  const groupId = uuid.parse(formData.get("share_group_id"));
  const back = `/taloyhtiot/${companyId}/huoneistot/${groupId}`;
  const data = parseForm(partyContactSchema, formData, back);
  await ctx.run(async (tx) => {
    // Osapuolen pitää liittyä tähän huoneistoon omistajana tai asukkaana.
    const [party] = await tx.query<{ organization_id: string; email: string | null; phone: string | null }>(
      `select p.organization_id, p.email, p.phone from er_parties p
        where p.id = $1
          and (exists (select 1 from er_ownerships o where o.party_id = p.id and o.share_group_id = $2)
            or exists (select 1 from er_residencies r where r.party_id = p.id and r.share_group_id = $2))`,
      [data.party_id, groupId],
    );
    if (!party) fail(back, "Henkilöä ei löytynyt tästä huoneistosta.");
    await tx.query("update er_parties set email = $2, phone = $3 where id = $1", [data.party_id, data.email, data.phone]);
    await audit(tx, {
      organizationId: party.organization_id,
      userId: ctx.user.id,
      action: "update",
      entity: "party_contact",
      entityId: data.party_id,
      details: { email_changed: party.email !== data.email, phone_changed: party.phone !== data.phone },
    });
  });
  revalidatePath(back);
  redirect(back);
}
