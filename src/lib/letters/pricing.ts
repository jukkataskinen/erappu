/**
 * Postikulujen veloitus taloyhtiöltä (Jukka 26.9.2026): organisaation oma
 * kirjehinta (asetukset, `settings.letter_prices`), ei Postitan hinta.
 * Hinnat ovat verottomia; arvonlisävero lisätään laskulle. Puhdasta
 * logiikkaa, ei kantaa.
 */

export interface LetterPrices {
  /** € / kirje alv 0, 1. luokka */
  class1_eur: number;
  /** € / kirje alv 0, 2. luokka */
  class2_eur: number;
  /** € / lisäsivu alv 0 (ensimmäisen sivun jälkeen) */
  extra_page_eur: number;
  vat_percent: number;
}

/** Yleinen arvonlisäverokanta 1.9.2024 alkaen. */
export const DEFAULT_VAT_PERCENT = 25.5;

export const MISSING_LETTER_PRICES = "Aseta kirjeiden hinnat taloyhtiöille asetuksiin (Asetukset, organisaatio) ennen postitusta, jotta postitus voidaan laskuttaa.";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Hinnat asetuksista, tai null, jos kirjehinta puuttuu. Lisäsivun tyhjä hinta = 0. */
export function letterPricesFrom(settings: { letter_prices?: Record<string, unknown> | null } | null | undefined): LetterPrices | null {
  const p = settings?.letter_prices;
  const class1 = num(p?.class1_eur);
  const class2 = num(p?.class2_eur);
  if (class1 === null || class2 === null) return null;
  return { class1_eur: class1, class2_eur: class2, extra_page_eur: num(p?.extra_page_eur) ?? 0, vat_percent: num(p?.vat_percent) ?? DEFAULT_VAT_PERCENT };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LetterCharge {
  letterEur: number;
  pageEur: number;
  totalEur: number;
}

export function chargeFor(prices: LetterPrices, postClass: 1 | 2, letters: number, pagesPerLetter: number): LetterCharge {
  const letterEur = postClass === 1 ? prices.class1_eur : prices.class2_eur;
  const pageEur = prices.extra_page_eur;
  return { letterEur, pageEur, totalEur: round2(letters * letterEur + letters * Math.max(0, pagesPerLetter - 1) * pageEur) };
}

/** Edellinen kalenterineljännes päivästä VVVV-KK-PP: laskutus noin kolmen kuukauden välein. */
export function previousQuarter(today: string): { start: string; end: string } {
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const q = quarter === 0 ? 3 : quarter - 1;
  const y = quarter === 0 ? year - 1 : year;
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(startMonth)}-01`, end: `${y}-${pad(endMonth)}-${pad(lastDay)}` };
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const fiDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

export interface BillableJob {
  description: string | null;
  confirmed_on: string;
  post_class: 1 | 2;
  letter_count: number;
  pages_per_letter: number;
  charge_letter_eur: number;
  charge_page_eur: number;
}

export interface InvoiceRow {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
}

/** Laskun rivit: jokainen postitus omana rivinään, lisäsivut omalla rivillään. Rivillä kerrotaan, mitä postitettiin. */
export function invoiceRows(jobs: BillableJob[]): InvoiceRow[] {
  const rows: InvoiceRow[] = [];
  for (const j of [...jobs].sort((a, b) => a.confirmed_on.localeCompare(b.confirmed_on))) {
    const what = j.description?.trim() || "Postitus";
    rows.push({
      name: `${what}, postitettu ${fiDate(j.confirmed_on)} (${j.post_class}. lk)`.slice(0, 250),
      quantity: j.letter_count,
      unit: "kpl",
      price: j.charge_letter_eur,
      total: round2(j.letter_count * j.charge_letter_eur),
    });
    const extra = j.letter_count * Math.max(0, j.pages_per_letter - 1);
    if (extra > 0 && j.charge_page_eur > 0) {
      rows.push({ name: `${what}: lisäsivut`.slice(0, 250), quantity: extra, unit: "kpl", price: j.charge_page_eur, total: round2(extra * j.charge_page_eur) });
    }
  }
  return rows;
}

export const INVOICE_CHANNELS = ["paper", "email", "einvoice"] as const;
export type InvoiceChannel = (typeof INVOICE_CHANNELS)[number];

export const INVOICE_CHANNEL_LABEL: Record<InvoiceChannel, string> = {
  paper: "Paperilasku postitse",
  email: "Sähköposti",
  einvoice: "Verkkolasku",
};

const FENNOA_DELIVERY: Record<InvoiceChannel, string> = { paper: "postal", email: "email", einvoice: "finvoice" };

export interface BillingProfile {
  company_name: string;
  business_id: string | null;
  fennoa_customer_no: string | null;
  invoice_channel: string | null;
  einvoice_address: string | null;
  einvoice_operator: string | null;
  email: string | null;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
}

/**
 * Laskutustietojen puutteet käyttäjälle näytettävinä lauseina. Laskukanavalle
 * ei ole oletusta: puuttuva kanava estää viennin. Fennoa vaatii laskulle
 * aina postiosoitteen.
 */
export function billingProblems(p: BillingProfile | null): string[] {
  if (!p) return ["Laskutustiedot puuttuvat."];
  const problems: string[] = [];
  if (!p.fennoa_customer_no?.trim()) problems.push("Fennoan asiakasnumero puuttuu.");
  if (!p.street_address?.trim() || !/^\d{5}$/.test(p.postal_code ?? "") || !p.city?.trim()) problems.push("Laskutusosoite puuttuu tai on puutteellinen.");
  if (!p.invoice_channel) problems.push("Laskukanava puuttuu.");
  if (p.invoice_channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email ?? "")) problems.push("Sähköpostilaskulta puuttuu kelvollinen osoite.");
  if (p.invoice_channel === "einvoice" && (!/^0037\d{8,13}$/.test((p.einvoice_address ?? "").replace(/\s/g, "")) || !p.einvoice_operator?.trim())) {
    problems.push("Verkkolaskulta puuttuu verkkolaskuosoite (0037…) tai välittäjä.");
  }
  return problems;
}

/** Fennoan sales_api/add-lomake. Hinnat verottomina, alv riveittäin. */
export function buildFennoaForm(input: {
  profile: BillingProfile;
  rows: InvoiceRow[];
  vatPercent: number;
  invoiceDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
}): Record<string, string> {
  const p = input.profile;
  const channel = p.invoice_channel as InvoiceChannel;
  const form: Record<string, string> = {
    customer_no: p.fennoa_customer_no ?? "",
    account_type_id: "1",
    name: p.company_name,
    address: p.street_address ?? "",
    postalcode: p.postal_code ?? "",
    city: p.city ?? "",
    country: "FI",
    email: p.email ?? "",
    invoice_date: input.invoiceDate,
    due_date: input.dueDate,
    locale: "fi",
    delivery_method: FENNOA_DELIVERY[channel],
    delivery_period_start: input.periodStart,
    delivery_period_end: input.periodEnd,
    notes_before: `Postikulut ${fiDate(input.periodStart)}–${fiDate(input.periodEnd)}: kirjeiden tulostus, kuoritus ja postitus.`,
  };
  if (p.business_id) form.business_id = p.business_id;
  if (channel === "email") form.einvoice_address = p.email ?? "";
  if (channel === "einvoice") {
    form.einvoice_address = (p.einvoice_address ?? "").replace(/\s/g, "");
    form.einvoice_operator = (p.einvoice_operator ?? "").replace(/\s/g, "").toUpperCase();
  }
  input.rows.forEach((r, i) => {
    const n = i + 1;
    form[`row[${n}][name]`] = r.name;
    form[`row[${n}][quantity]`] = String(r.quantity);
    form[`row[${n}][unit]`] = r.unit;
    form[`row[${n}][price]`] = String(r.price);
    form[`row[${n}][vatpercent]`] = String(input.vatPercent);
  });
  return form;
}
