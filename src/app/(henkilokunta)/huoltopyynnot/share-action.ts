"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/current-user";
import { whatsappShareUrl } from "@/lib/service-requests/messages";
import { orderFromProvider, RequestError } from "@/lib/service-requests/mutations";
import { uuid } from "@/lib/service-requests/schemas";

export type ShareOrderState = { status: "idle" } | { status: "error"; message: string } | { status: "ready"; text: string; whatsappUrl: string };

/**
 * Tilaus jakolinkkinä. Palauttaa linkin lomakkeelle eikä ohjaa uudelle
 * sivulle, jotta linkki ei päädy osoiteriville, selainhistoriaan eikä
 * palvelimen lokeihin.
 */
export async function shareProviderOrder(_prev: ShareOrderState, formData: FormData): Promise<ShareOrderState> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) return { status: "error", message: "Roolillasi ei voi tilata töitä." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Huoltopyyntöä ei löytynyt." };
  try {
    const result = await ctx.run(async (tx) => {
      const order = await orderFromProvider(tx, { requestId: id.data, actor: { userId: ctx.user.id }, channel: "share" });
      const [p] = await tx.query<{ phone: string | null }>(
        "select p.phone from er_service_requests r join er_service_providers p on p.id = r.provider_id where r.id = $1",
        [id.data],
      );
      return { ...order, phone: p?.phone ?? null };
    });
    revalidatePath(`/huoltopyynnot/${id.data}`);
    revalidatePath("/huoltopyynnot");
    return { status: "ready", text: result.shareText, whatsappUrl: whatsappShareUrl(result.shareText, result.phone) };
  } catch (err) {
    if (err instanceof RequestError) return { status: "error", message: err.message };
    throw err;
  }
}
