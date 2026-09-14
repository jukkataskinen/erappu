"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { createPortalInvitation } from "@/lib/invitations";

export interface InvitePartyState {
  status: "idle" | "sent" | "already" | "error";
  message: string | null;
}

const schema = z.object({
  party_id: z.string().uuid(),
  company_id: z.string().uuid(),
  role: z.enum(["owner", "resident", "board"]),
});

/**
 * Portaalikutsu rekisterin huoneisto- tai hallitussivulta. Palauttaa tilan
 * napille (useActionState), jotta rekisterisivun tiedostoa ei tarvitse
 * muuttaa ilmoitusten näyttämiseksi.
 */
export async function invitePartyToPortal(_prev: InvitePartyState, formData: FormData): Promise<InvitePartyState> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) return { status: "error", message: "Portaalikutsun lähettää isännöitsijä tai pääkäyttäjä." };
  const parsed = schema.safeParse({ party_id: formData.get("party_id"), company_id: formData.get("company_id"), role: formData.get("role") });
  if (!parsed.success) return { status: "error", message: "Kutsua ei voitu lähettää." };
  const d = parsed.data;
  const res = await ctx.run((tx) => createPortalInvitation(tx, { partyId: d.party_id, companyId: d.company_id, role: d.role, inviterId: ctx.user.id }));
  switch (res.status) {
    case "sent":
      revalidatePath("/asetukset/portaali");
      return { status: "sent", message: "Kutsu lähetetty" };
    case "already_in_portal":
      return { status: "already", message: "On jo portaalissa" };
    case "no_email":
      return { status: "error", message: "Sähköposti puuttuu" };
    default:
      return { status: "error", message: "Henkilöä ei löytynyt tästä yhtiöstä" };
  }
}
