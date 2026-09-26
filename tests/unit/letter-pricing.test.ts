import { describe, expect, it } from "vitest";
import { billingProblems, buildFennoaForm, chargeFor, invoiceRows, letterPricesFrom, previousQuarter, type BillingProfile } from "@/lib/letters/pricing";

describe("kirjehinnat", () => {
  it("hinnat asetuksista; ilman kirjehintaa ei hintoja", () => {
    expect(letterPricesFrom({ letter_prices: { class1_eur: 3.9, class2_eur: 2.9 } })).toEqual({ class1_eur: 3.9, class2_eur: 2.9, extra_page_eur: 0, vat_percent: 25.5 });
    expect(letterPricesFrom({ letter_prices: { class1_eur: 3.9, class2_eur: null } })).toBeNull();
    expect(letterPricesFrom({})).toBeNull();
  });

  it("veloitus: kirjeet ja lisäsivut", () => {
    const prices = { class1_eur: 3.9, class2_eur: 2.9, extra_page_eur: 0.2, vat_percent: 25.5 };
    expect(chargeFor(prices, 2, 10, 3)).toEqual({ letterEur: 2.9, pageEur: 0.2, totalEur: 33 });
    expect(chargeFor(prices, 1, 3, 1)).toEqual({ letterEur: 3.9, pageEur: 0.2, totalEur: 11.7 });
  });

  it("oletusjakso on edellinen vuosineljännes", () => {
    expect(previousQuarter("2026-09-26")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(previousQuarter("2026-10-01")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(previousQuarter("2027-02-15")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });
});

describe("laskun rivit", () => {
  it("jokainen postitus omalla rivillään ja lisäsivut erikseen, aikajärjestyksessä", () => {
    const rows = invoiceRows([
      { description: "Tiedote: Vesikatko", confirmed_on: "2026-09-02", post_class: 2, letter_count: 3, pages_per_letter: 1, charge_letter_eur: 2.9, charge_page_eur: 0.2 },
      { description: "Kokouskutsu: varsinainen yhtiökokous 12.5.2026", confirmed_on: "2026-04-20", post_class: 1, letter_count: 4, pages_per_letter: 3, charge_letter_eur: 3.9, charge_page_eur: 0.2 },
    ]);
    expect(rows).toEqual([
      { name: "Kokouskutsu: varsinainen yhtiökokous 12.5.2026, postitettu 20.4.2026 (1. lk)", quantity: 4, unit: "kpl", price: 3.9, total: 15.6 },
      { name: "Kokouskutsu: varsinainen yhtiökokous 12.5.2026: lisäsivut", quantity: 8, unit: "kpl", price: 0.2, total: 1.6 },
      { name: "Tiedote: Vesikatko, postitettu 2.9.2026 (2. lk)", quantity: 3, unit: "kpl", price: 2.9, total: 8.7 },
    ]);
  });
});

const profile: BillingProfile = {
  company_name: "As Oy Testi",
  business_id: "1234567-1",
  fennoa_customer_no: "1042",
  invoice_channel: "einvoice",
  einvoice_address: "0037 12345671",
  einvoice_operator: "003723327487",
  email: null,
  street_address: "Testitie 1",
  postal_code: "41660",
  city: "Toivakka",
};

describe("laskutustiedot ja Fennoa", () => {
  it("laskukanavalle ei ole oletusta", () => {
    expect(billingProblems({ ...profile, invoice_channel: null })).toContain("Laskukanava puuttuu.");
    expect(billingProblems(null)).toEqual(["Laskutustiedot puuttuvat."]);
    expect(billingProblems(profile)).toEqual([]);
    expect(billingProblems({ ...profile, invoice_channel: "email" })).toContain("Sähköpostilaskulta puuttuu kelvollinen osoite.");
    expect(billingProblems({ ...profile, einvoice_address: "12345" })[0]).toMatch(/verkkolaskuosoite/);
    expect(billingProblems({ ...profile, postal_code: "416" })).toContain("Laskutusosoite puuttuu tai on puutteellinen.");
  });

  it("Fennoan lomake: asiakas, verkkolasku, jakso ja rivit verottomina", () => {
    const form = buildFennoaForm({
      profile,
      rows: [{ name: "Tiedote: Vesikatko, postitettu 2.9.2026 (2. lk)", quantity: 3, unit: "kpl", price: 2.9, total: 8.7 }],
      vatPercent: 25.5,
      invoiceDate: "2026-10-01",
      dueDate: "2026-10-15",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(form).toMatchObject({
      customer_no: "1042",
      name: "As Oy Testi",
      business_id: "1234567-1",
      delivery_method: "finvoice",
      einvoice_address: "003712345671",
      einvoice_operator: "003723327487",
      invoice_date: "2026-10-01",
      due_date: "2026-10-15",
      delivery_period_start: "2026-07-01",
      delivery_period_end: "2026-09-30",
      "row[1][quantity]": "3",
      "row[1][price]": "2.9",
      "row[1][vatpercent]": "25.5",
    });
    expect(form.notes_before).toBe("Postikulut 1.7.2026–30.9.2026: kirjeiden tulostus, kuoritus ja postitus.");
    expect(form.include_vat).toBeUndefined();
  });
});
