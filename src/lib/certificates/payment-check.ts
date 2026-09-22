import { z } from "zod";
import { emptyToNull } from "@/lib/forms";

/**
 * Todistustilauksen maksutilanne kirjanpidosta (0115): tyhjä = ei tarkistettu,
 * none = ei erääntyneitä, overdue = erääntyneet euroina. Lomakekentät
 * payment_state, payment_overdue_eur ja payment_checked_on.
 */
export const paymentCheckFields = {
  payment_state: z.preprocess(emptyToNull, z.enum(["none", "overdue"]).nullable()),
  payment_overdue_eur: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? Number(v.trim().replace(/\s/g, "").replace(",", ".")) : null),
    z.number({ message: "Tarkista erääntyneiden maksujen summa." }).min(0, "Tarkista erääntyneiden maksujen summa.").max(10_000_000).nullable(),
  ),
  payment_checked_on: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista maksutilanteen päivä.").nullable()),
};

const schema = z.object(paymentCheckFields);

export type PaymentCheck = { overdueEur: number; checkedOn: string } | null;

/** Tulkitsee kentät. Palauttaa virheviestin tai tarkistetun tilanteen (null = ei tarkistettu). */
export function parsePaymentCheck(fields: Record<string, unknown>): { ok: true; payment: PaymentCheck } | { ok: false; error: string } {
  const parsed = schema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Tarkista maksutilanne." };
  const d = parsed.data;
  if (!d.payment_state) return { ok: true, payment: null };
  if (d.payment_state === "overdue" && !(d.payment_overdue_eur && d.payment_overdue_eur > 0)) return { ok: false, error: "Anna erääntyneiden maksujen summa." };
  if (!d.payment_checked_on) return { ok: false, error: "Anna päivä, jolta maksutilanne on tarkistettu." };
  return { ok: true, payment: { overdueEur: d.payment_state === "none" ? 0 : d.payment_overdue_eur!, checkedOn: d.payment_checked_on } };
}
