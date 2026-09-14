"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { cancelBooking } from "@/lib/bookings/queries";
import { openHoursSchema, WEEKDAYS, type OpenHours } from "@/lib/bookings/slots";
import { emptyToNull, fail, parseForm } from "@/lib/forms";

const uuid = z.string().uuid();

const resourceSchema = z.object({
  name: z.string().min(1, "Anna kohteen nimi.").max(100),
  description: z.preprocess(emptyToNull, z.string().max(2000).nullable()),
  slot_minutes: z.coerce.number().int().min(15, "Vuoron pituus on 15–1440 minuuttia.").max(1440, "Vuoron pituus on 15–1440 minuuttia."),
  max_active_bookings_per_unit: z.preprocess(emptyToNull, z.coerce.number().int().min(1, "Kiintiö on vähintään 1.").max(100).nullable()),
  allow_recurring: z.preprocess((v) => v === "on", z.boolean()),
  active: z.preprocess((v) => v === "on", z.boolean()),
  price_eur: z.preprocess(
    (v) => (typeof v === "string" ? emptyToNull(v.replace(/\s/g, "").replace(",", ".")) : v),
    z.coerce.number().min(0).max(100_000).nullable(),
  ),
});

/** Lomakkeen kentät open_mon_start / open_mon_end → {"mon": [["18:00","22:00"]]}. */
function openHoursFrom(formData: FormData, back: string): OpenHours {
  const out: Record<string, [string, string][]> = {};
  for (const d of WEEKDAYS) {
    const s = String(formData.get(`open_${d}_start`) ?? "").trim();
    const e = String(formData.get(`open_${d}_end`) ?? "").trim();
    if (!s && !e) continue;
    if (!s || !e) fail(back, "Anna aukioloajalle sekä alku että loppu, tai jätä päivä tyhjäksi.");
    out[d] = [[s, e === "00:00" ? "24:00" : e]];
  }
  const parsed = openHoursSchema.safeParse(out);
  if (!parsed.success) fail(back, "Tarkista aukioloajat: alku ennen loppua, muodossa tt:mm.");
  return parsed.data as OpenHours;
}

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata varauskohteita.");
  return ctx;
}

export async function saveResourceAction(formData: FormData) {
  const id = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const back = id ? `/varaukset/${id}` : "/varaukset";
  const ctx = await writer(back);
  const data = parseForm(resourceSchema, formData, back);
  const hours = openHoursFrom(formData, back);

  const savedId = await ctx.run(async (tx) => {
    if (id) {
      const rows = await tx.query<{ id: string; organization_id: string }>(
        `update er_bookable_resources set name=$2, description=$3, slot_minutes=$4, open_hours=$5, max_active_bookings_per_unit=$6,
                allow_recurring=$7, price_eur=$8, active=$9
          where id=$1 returning id, organization_id`,
        [id, data.name, data.description, data.slot_minutes, JSON.stringify(hours), data.max_active_bookings_per_unit, data.allow_recurring, data.price_eur, data.active],
      );
      if (rows.length === 0) fail("/varaukset", "Kohdetta ei löytynyt.");
      await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "bookable_resource", entityId: id });
      return id;
    }
    const companyId = z.string().uuid().safeParse(formData.get("company_id"));
    if (!companyId.success) fail(back, "Valitse yhtiö.");
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [companyId.data]);
    if (!company) fail(back, "Yhtiötä ei löytynyt.");
    const [row] = await tx.query<{ id: string }>(
      `insert into er_bookable_resources (organization_id, company_id, name, description, slot_minutes, open_hours, max_active_bookings_per_unit, allow_recurring, price_eur, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [company.organization_id, companyId.data, data.name, data.description, data.slot_minutes, JSON.stringify(hours), data.max_active_bookings_per_unit, data.allow_recurring, data.price_eur, data.active],
    );
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create", entity: "bookable_resource", entityId: row.id });
    return row.id;
  });
  revalidatePath("/varaukset");
  redirect(`/varaukset/${savedId}?tallennettu=1`);
}

export async function staffCancelBookingAction(formData: FormData) {
  const resourceId = uuid.parse(formData.get("resource_id"));
  const bookingId = uuid.parse(formData.get("booking_id"));
  const wholeSeries = formData.get("series") === "1";
  const week = String(formData.get("viikko") ?? "");
  const back = `/varaukset/${resourceId}${/^\d{4}-\d{2}-\d{2}$/.test(week) ? `?viikko=${week}` : ""}`;
  const ctx = await writer(back);
  await ctx.run(async (tx) => {
    const res = await cancelBooking(tx, { bookingId, userId: ctx.user.id, wholeSeries });
    if (res.organizationId) {
      await audit(tx, { organizationId: res.organizationId, userId: ctx.user.id, action: "cancel", entity: "booking", entityId: bookingId, details: { count: res.cancelled } });
    }
  });
  revalidatePath(`/varaukset/${resourceId}`);
  redirect(back);
}
