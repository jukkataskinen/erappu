import { describe, expect, it } from "vitest";
import { parsePaymentCheck } from "@/lib/certificates/payment-check";

/** Todistustilauksen maksutilanteen lomakekentät (0115). */
describe("maksutilanteen lomake", () => {
  it("ei tarkistettu", () => {
    expect(parsePaymentCheck({ payment_state: "", payment_overdue_eur: "", payment_checked_on: "2026-09-22" })).toEqual({ ok: true, payment: null });
  });

  it("ei erääntyneitä maksuja, päivä selaimen date-kentästä", () => {
    expect(parsePaymentCheck({ payment_state: "none", payment_overdue_eur: "", payment_checked_on: "2026-09-22" })).toEqual({
      ok: true,
      payment: { overdueEur: 0, checkedOn: "2026-09-22" },
    });
  });

  it("erääntyneet: pilkku ja välilyönti summassa", () => {
    expect(parsePaymentCheck({ payment_state: "overdue", payment_overdue_eur: "1 276,50", payment_checked_on: "2026-09-22" })).toEqual({
      ok: true,
      payment: { overdueEur: 1276.5, checkedOn: "2026-09-22" },
    });
  });

  it("virheet", () => {
    expect(parsePaymentCheck({ payment_state: "overdue", payment_overdue_eur: "", payment_checked_on: "2026-09-22" })).toEqual({ ok: false, error: "Anna erääntyneiden maksujen summa." });
    expect(parsePaymentCheck({ payment_state: "none", payment_overdue_eur: "", payment_checked_on: "" })).toEqual({ ok: false, error: "Anna päivä, jolta maksutilanne on tarkistettu." });
    expect(parsePaymentCheck({ payment_state: "none", payment_checked_on: "22.9.2026" })).toEqual({ ok: false, error: "Tarkista maksutilanteen päivä." });
  });
});
