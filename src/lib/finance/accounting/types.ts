import type { ParsedPaymentRow } from "../payment-import";

/**
 * Kirjanpitoadapteri. eRappu laskee laskutuksen perusteet, kirjanpito pitää
 * rahan. Procountoriin (31.12.2027 asti) tiedostoina, Adepta PPR:ään
 * (1.1.2028 alkaen) rajapinnan kautta. Muiden isännöintiyritysten
 * kirjanpitojärjestelmät liitetään ensin CSV-toteutuksella.
 */
export interface BillingExportLine {
  unitLabel: string;
  payerName: string | null;
  payerCustomerNo: string | null;
  payerStreet: string | null;
  payerPostalCode: string | null;
  payerCity: string | null;
  chargeType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amountEur: string;
  vatPercent: string;
  referenceNumber: string;
}

export interface BillingRunExport {
  runId: string;
  /** Vastikeajo tai vesimaksun tasaus (0100). */
  kind?: "charges" | "water_settlement";
  companyName: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  iban: string | null;
  bic: string | null;
  lines: BillingExportLine[];
}

export interface ExportedFile {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface PaymentStatusParse {
  rows: ParsedPaymentRow[];
  errors: string[];
}

export interface KirjanpitoAdapteri {
  readonly name: "csv" | "ppr";
  /** Hyväksytyn laskutusajon vienti kirjanpitoon (tiedosto tai rajapintakutsu). */
  exportBillingRun(input: BillingRunExport): Promise<ExportedFile>;
  /** Maksutilanne kirjanpidosta osakeryhmittäin; kohdistus tehdään kutsujassa viitteellä. */
  importPaymentStatus(input: { fileName: string; bytes: Uint8Array }): Promise<PaymentStatusParse>;
}
