"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fail } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { MarketplaceError, openReservedTask, reserveListing } from "@/lib/marketplace/mutations";
import { resolveMarketplaceProvider } from "@/lib/marketplace/queries";
import { RequestError } from "@/lib/service-requests/mutations";

/**
 * Palveluntuottajan toiminnot torilinkistä. Ei kirjautumista: linkki
 * ratkaistaan jokaisessa kutsussa uudelleen palvelun roolilla, ja rajaus
 * (organisaatio, hyväksyntä, yhtiön torisäännöt) tehdään kirjoituksissa.
 */

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

function tokenFrom(formData: FormData): string {
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) notFound();
  return token;
}

const reserveSchema = z.object({
  listing_id: z.string().uuid(),
  estimated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna arvioitu toteutuspäivä."),
  estimated_hours: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(",", ".")) : v), z.number({ message: "Anna tuntiarvio." })),
});

export async function reserve(formData: FormData) {
  const token = tokenFrom(formData);
  const back = `/tori/${token}`;
  const parsed = reserveSchema.safeParse({
    listing_id: formData.get("listing_id"),
    estimated_on: formData.get("estimated_on"),
    estimated_hours: formData.get("estimated_hours"),
  });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Tarkista varauksen tiedot.");
  const d = parsed.data;

  let target: string | null = null;
  let message: string | null = null;
  try {
    const db = await getDb();
    target = await db.asService(async (tx) => {
      const provider = await resolveMarketplaceProvider(tx, token);
      if (!provider) throw new MarketplaceError("Torilinkki ei ole enää voimassa. Pyydä isännöinniltä uusi linkki.");
      const res = await reserveListing(tx, { provider, listingId: d.listing_id, estimatedOn: d.estimated_on, estimatedHours: d.estimated_hours, today: isoDateHelsinki() });
      // Tilattu työ avautuu suoraan tehtävälinkkiin; hyväksyntää odottava palaa torille ilmoituksen kera.
      return res.status === "reserved" ? res.link.slice(res.link.indexOf("/tehtava/")) : `${back}?tila=odottaa`;
    });
  } catch (err) {
    if (err instanceof MarketplaceError || err instanceof RequestError) message = err.message;
    else throw err;
  }
  if (message || !target) fail(back, message ?? "Varausta ei voitu tehdä.");
  redirect(target);
}

export async function openTask(formData: FormData) {
  const token = tokenFrom(formData);
  const back = `/tori/${token}`;
  const listingId = z.string().uuid().safeParse(formData.get("listing_id"));
  if (!listingId.success) fail(back, "Varausta ei löytynyt.");
  let taskToken: string | null = null;
  let message: string | null = null;
  try {
    const db = await getDb();
    taskToken = await db.asService(async (tx) => {
      const provider = await resolveMarketplaceProvider(tx, token);
      if (!provider) throw new MarketplaceError("Torilinkki ei ole enää voimassa. Pyydä isännöinniltä uusi linkki.");
      return openReservedTask(tx, { provider, listingId: listingId.data });
    });
  } catch (err) {
    if (err instanceof MarketplaceError) message = err.message;
    else throw err;
  }
  if (message || !taskToken) fail(back, message ?? "Tehtävää ei voitu avata.");
  redirect(`/tehtava/${taskToken}`);
}
