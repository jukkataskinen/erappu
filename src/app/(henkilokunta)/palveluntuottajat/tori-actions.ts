"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/forms";
import { createMarketplaceLink, MarketplaceError, revokeMarketplaceLinks, setApproval } from "@/lib/marketplace/mutations";
import { RESERVATION_DAYS } from "@/lib/marketplace/rules";
import { whatsappShareUrl } from "@/lib/service-requests/messages";

/** Palveluntuottajan torihyväksynnät, tuntihinta ja torilinkki (0096). */

const uuid = z.string().uuid();

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata palveluntuottajia.");
  return ctx;
}

async function run(back: string, fn: () => Promise<unknown>) {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof MarketplaceError) message = err.message;
    else throw err;
  }
  if (message) fail(back, message);
}

const rateSchema = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(",", ".").replace(/\s/g, ""))) : v),
  z.number({ message: "Anna tuntihinta euroina." }).positive("Tuntihinnan on oltava positiivinen.").max(10000).nullable(),
);

export async function setHourlyRate(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  const rate = rateSchema.safeParse(formData.get("hourly_rate_eur"));
  if (!rate.success) fail(back, rate.error.issues[0]?.message ?? "Tarkista tuntihinta.");
  await run(back, () =>
    ctx.run(async (tx) => {
      const rows = await tx.query("update er_service_providers set hourly_rate_eur = $2 where id = $1 returning id", [providerId, rate.data]);
      if (rows.length === 0) throw new MarketplaceError("Palveluntuottajaa ei löytynyt.");
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "service_provider", entityId: providerId, details: { hourly_rate_eur: rate.data } });
    }),
  );
  revalidatePath(back);
  redirect(`${back}#tori`);
}

export async function setMarketplaceApproval(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  const companyRaw = String(formData.get("company_id") ?? "");
  const companyId = companyRaw === "" ? null : uuid.parse(companyRaw);
  const approved = formData.get("approved") === "1";
  await run(back, () => ctx.run((tx) => setApproval(tx, { providerId, organizationId: ctx.org.organizationId, companyId, approved, userId: ctx.user.id })));
  revalidatePath(back);
  redirect(`${back}#tori`);
}

export async function revokeProviderMarketplaceLink(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  await run(back, () => ctx.run((tx) => revokeMarketplaceLinks(tx, { providerId, organizationId: ctx.org.organizationId, userId: ctx.user.id })));
  revalidatePath(back);
  redirect(`${back}#tori`);
}

export type LinkState = { status: "idle" } | { status: "error"; message: string } | { status: "ready"; text: string; whatsappUrl: string };

/** Uusi torilinkki palautetaan lomakkeelle jaettavaksi; edellinen linkki mitätöityy. */
export async function createProviderMarketplaceLink(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) return { status: "error", message: "Roolillasi ei voi luoda torilinkkiä." };
  const providerId = uuid.safeParse(formData.get("provider_id"));
  if (!providerId.success) return { status: "error", message: "Palveluntuottajaa ei löytynyt." };
  try {
    const { link, phone, orgName } = await ctx.run(async (tx) => {
      const url = await createMarketplaceLink(tx, { providerId: providerId.data, organizationId: ctx.org.organizationId, userId: ctx.user.id });
      const [p] = await tx.query<{ phone: string | null }>("select phone from er_service_providers where id = $1", [providerId.data]);
      return { link: url, phone: p?.phone ?? null, orgName: ctx.org.organizationName };
    });
    revalidatePath(`/palveluntuottajat/${providerId.data}`);
    const text = [
      `${orgName}: huoltotöiden tori. Näet vapaat työt ja voit varata niitä tästä linkistä:`,
      link,
      `Varaus on voimassa ${RESERVATION_DAYS} päivää. Linkki on henkilökohtainen, älä välitä sitä eteenpäin.`,
    ].join("\n");
    return { status: "ready", text, whatsappUrl: whatsappShareUrl(text, phone) };
  } catch (err) {
    if (err instanceof MarketplaceError) return { status: "error", message: err.message };
    throw err;
  }
}
