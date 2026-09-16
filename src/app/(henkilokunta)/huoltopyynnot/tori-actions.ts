"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { approveReservation, cancelListing, listOnMarketplace, MarketplaceError, rejectReservation } from "@/lib/marketplace/mutations";
import { whatsappShareUrl } from "@/lib/service-requests/messages";
import { RequestError } from "@/lib/service-requests/mutations";

/** Torin toiminnot huoltopyynnön sivulta. RLS rajaa organisaatioon ja kirjoittaviin rooleihin (0096). */

const uuid = z.string().uuid();

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muuttaa toria.");
  return ctx;
}

function refresh(requestId: string) {
  revalidatePath(`/huoltopyynnot/${requestId}`);
  revalidatePath("/huoltopyynnot");
  revalidatePath("/tyopoyta");
}

async function run(back: string, fn: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof MarketplaceError || err instanceof RequestError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
}

export async function listRequestOnMarketplace(formData: FormData) {
  const requestId = uuid.parse(formData.get("request_id"));
  const back = `/huoltopyynnot/${requestId}`;
  const ctx = await writer(back);
  const summary = String(formData.get("summary") ?? "");
  await run(back, () => ctx.run((tx) => listOnMarketplace(tx, { requestId, summary, userId: ctx.user.id })));
  refresh(requestId);
  redirect(`${back}?tori=listattu#tori`);
}

export async function cancelMarketplaceListing(formData: FormData) {
  const requestId = uuid.parse(formData.get("request_id"));
  const listingId = uuid.parse(formData.get("listing_id"));
  const back = `/huoltopyynnot/${requestId}`;
  const ctx = await writer(back);
  await run(back, () => ctx.run((tx) => cancelListing(tx, { listingId, userId: ctx.user.id })));
  refresh(requestId);
  redirect(`${back}?tori=poistettu#tori`);
}

export async function rejectMarketplaceReservation(formData: FormData) {
  const requestId = uuid.parse(formData.get("request_id"));
  const listingId = uuid.parse(formData.get("listing_id"));
  const back = `/huoltopyynnot/${requestId}`;
  const ctx = await writer(back);
  await run(back, () => ctx.run((tx) => rejectReservation(tx, { listingId, userId: ctx.user.id })));
  refresh(requestId);
  redirect(`${back}?tori=hylatty#tori`);
}

export type ApproveState = { status: "idle" } | { status: "error"; message: string } | { status: "ready"; text: string; whatsappUrl: string; emailed: boolean };

/** Hyväksyntä palauttaa tehtävälinkin lomakkeelle (ei osoiteriville), jotta isännöitsijä voi jakaa sen. */
export async function approveMarketplaceReservation(_prev: ApproveState, formData: FormData): Promise<ApproveState> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) return { status: "error", message: "Roolillasi ei voi hyväksyä varauksia." };
  const requestId = uuid.safeParse(formData.get("request_id"));
  const listingId = uuid.safeParse(formData.get("listing_id"));
  if (!requestId.success || !listingId.success) return { status: "error", message: "Varausta ei löytynyt." };
  try {
    const result = await ctx.run(async (tx) => {
      const approved = await approveReservation(tx, { listingId: listingId.data, userId: ctx.user.id });
      const [p] = await tx.query<{ phone: string | null }>(
        "select p.phone from er_marketplace_listings l join er_service_providers p on p.id = l.provider_id where l.id = $1",
        [listingId.data],
      );
      return { ...approved, phone: p?.phone ?? null };
    });
    // Ei revalidointia tässä: sivun päivitys vaihtaisi torikohdan tilaan "Varattu" ja
    // poistaisi jaettavan linkin näkyvistä. Lomake päivittää sivun, kun linkki on jaettu.
    return { status: "ready", text: result.shareText, whatsappUrl: whatsappShareUrl(result.shareText, result.phone), emailed: result.emailed };
  } catch (err) {
    if (err instanceof MarketplaceError || err instanceof RequestError) return { status: "error", message: err.message };
    throw err;
  }
}
