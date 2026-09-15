"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  insurance_company: optText,
  insurance_type: optText,
  property_maintenance: optText,
  commercial_register_note: optText,
});

function redemptionFrom(formData: FormData) {
  return Object.fromEntries(REDEMPTION_CLAUSE.map((r) => [r.key, formData.get(`rc_${r.key}`) === "on"]));
}

export async function createCompany(formData: FormData) {
  const ctx = await staffWriter();
  const data = parseForm(companySchema, formData, "/taloyhtiot/uusi");
  let id: string;
  try {
    id = await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into er_housing_companies (organization_id, name, business_id, company_form, street_address, postal_code, city,
            articles_date, fiscal_year_start, total_shares, manager_user_id, management_started_on, same_charge_basis,
            insurance_company, insurance_type, property_maintenance, commercial_register_note, redemption_clause)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
        [ctx.org.organizationId, data.name, data.business_id, data.company_form, data.street_address, data.postal_code, data.city,
          data.articles_date, data.fiscal_year_start, data.total_shares, data.manager_user_id ?? ctx.user.id, data.management_started_on,
          data.same_charge_basis, data.insurance_company, data.insurance_type, data.property_maintenance, data.commercial_register_note,
          JSON.stringify(redemptionFrom(formData))],
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
      const r = await tx.query(
        `update er_housing_companies set name=$2, business_id=$3, company_form=$4, street_address=$5, postal_code=$6, city=$7,
            articles_date=$8, fiscal_year_start=$9, total_shares=$10, manager_user_id=$11, management_started_on=$12,
            same_charge_basis=$13, insurance_company=$14, insurance_type=$15, property_maintenance=$16,
            commercial_register_note=$17, redemption_clause=$18
          where id=$1 returning id`,
        [id, data.name, data.business_id, data.company_form, data.street_address, data.postal_code, data.city, data.articles_date,
          data.fiscal_year_start, data.total_shares, data.manager_user_id, data.management_started_on, data.same_charge_basis,
          data.insurance_company, data.insurance_type, data.property_maintenance, data.commercial_register_note, JSON.stringify(redemptionFrom(formData))],
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
  redirect(`/taloyhtiot/${id}`);
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

const buildingSchema = z.object({
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
