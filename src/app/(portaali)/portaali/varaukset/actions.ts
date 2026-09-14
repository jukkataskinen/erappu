"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortal } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { bookingErrorMessage, cancelBooking, createBooking, getResource } from "@/lib/bookings/queries";
import { findSlot } from "@/lib/bookings/slots";
import { fail } from "@/lib/forms";

const uuid = z.string().uuid();

function backTo(resourceId: string | null, week: FormDataEntryValue | null, extra = ""): string {
  const params = new URLSearchParams();
  if (resourceId) params.set("kohde", resourceId);
  if (typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week)) params.set("viikko", week);
  const q = params.toString();
  return `/portaali/varaukset${q ? `?${q}` : ""}${extra ? `${q ? "&" : "?"}${extra}` : ""}`;
}

export async function bookSlotAction(formData: FormData) {
  const ctx = await requirePortal();
  const resourceId = uuid.safeParse(formData.get("resource_id"));
  if (!resourceId.success) redirect("/portaali/varaukset");
  const back = backTo(resourceId.data, formData.get("viikko"));
  const shareGroupId = uuid.safeParse(formData.get("share_group_id"));
  const startsAt = z.string().max(40).safeParse(formData.get("starts_at"));
  const recurring = formData.get("recurring") === "1";
  if (!shareGroupId.success || !startsAt.success) fail(back, "Valitse vuoro uudelleen.");

  let result: { created: number; skipped: number; organizationId: string } | null = null;
  try {
    result = await ctx.run(async (tx) => {
      const resource = await getResource(tx, resourceId.data);
      if (!resource || !resource.active) fail("/portaali/varaukset", "Kohde ei ole varattavissa.");
      // Huoneiston on oltava käyttäjän oma saman yhtiön huoneisto (kanta tarkistaa saman).
      const grant = ctx.user.portal.find((g) => g.companyId === resource.company_id && g.shareGroupId === shareGroupId.data && (g.role === "owner" || g.role === "resident"));
      if (!grant) fail(back, "Valitse huoneisto, jonka nimissä varaat.");
      const slot = findSlot(startsAt.data, resource.open_hours, resource.slot_minutes);
      if (!slot || new Date(slot.startsAt).getTime() <= Date.now()) fail(back, "Vuoro ei ole enää varattavissa.");
      const r = await createBooking(tx, { resource, slot, shareGroupId: shareGroupId.data, userId: ctx.user.id, recurring });
      await audit(tx, { organizationId: resource.organization_id, userId: ctx.user.id, action: "create", entity: "booking", entityId: r.seriesId, details: { created: r.created, recurring } });
      return { created: r.created, skipped: r.skipped, organizationId: resource.organization_id };
    });
  } catch (err) {
    const message = bookingErrorMessage(err);
    if (message) fail(back, message);
    throw err;
  }
  revalidatePath("/portaali/varaukset");
  revalidatePath("/portaali");
  redirect(backTo(resourceId.data, formData.get("viikko"), `varattu=${result!.created}${result!.skipped ? `&ohitettu=${result!.skipped}` : ""}`));
}

export async function cancelOwnBookingAction(formData: FormData) {
  const ctx = await requirePortal();
  const bookingId = uuid.safeParse(formData.get("booking_id"));
  const resourceId = uuid.safeParse(formData.get("resource_id"));
  const back = backTo(resourceId.success ? resourceId.data : null, formData.get("viikko"));
  if (!bookingId.success) fail(back, "Varausta ei löytynyt.");
  const wholeSeries = formData.get("series") === "1";
  const res = await ctx.run(async (tx) => {
    const r = await cancelBooking(tx, { bookingId: bookingId.data, userId: ctx.user.id, wholeSeries, onlyOwn: true });
    if (r.organizationId) {
      await audit(tx, { organizationId: r.organizationId, userId: ctx.user.id, action: "cancel", entity: "booking", entityId: bookingId.data, details: { count: r.cancelled } });
    }
    return r;
  });
  if (res.cancelled === 0) fail(back, "Varausta ei voitu perua. Mennyttä varausta ei voi perua.");
  revalidatePath("/portaali/varaukset");
  revalidatePath("/portaali");
  redirect(backTo(resourceId.success ? resourceId.data : null, formData.get("viikko"), `peruttu=${res.cancelled}`));
}
