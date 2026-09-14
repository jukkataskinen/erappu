import { fiDate } from "../dates";
import { CHARGE_TYPE } from "../labels";
import { decodeCsv, parsePaymentCsv } from "../payment-import";
import type { BillingRunExport, ExportedFile, KirjanpitoAdapteri } from "./types";

/**
 * CSV-adapteri (Procountor 2027 ja muut kirjanpitojärjestelmät).
 *
 * TODO(Procountor-tuontipohja): Procountorin myyntilaskujen tuontimuodon
 * tarkat sarakkeet eivät ole tiedossa. Tiedosto on tehty selkeäksi
 * välimuodoksi, jonka Procountorin tuontityökalu tai taulukkolaskenta
 * muuntaa. Kun pohja saadaan, lisää tänne oma sarakejärjestys.
 *
 * Muoto: UTF-8 BOM:lla (Excel tunnistaa ääkköset), erotin puolipiste,
 * rivinvaihto CRLF, desimaalit pilkulla ilman tuhaterotinta, päivät
 * muodossa p.k.vvvv. Yksi rivi = yksi laskurivi; saman viitteen rivit
 * muodostavat yhden laskun.
 *
 * Sarakkeet:
 *   Laskutusajo        eRapun ajon tunniste (uuid), täsmäytykseen
 *   Yhtiö, Y-tunnus    laskuttaja
 *   Kausi alkaa/päättyy laskutuskausi
 *   Eräpäivä           laskun eräpäivä
 *   Huoneisto          osakeryhmän tunnus
 *   Maksaja            ensisijainen maksaja (suurin omistusosuus)
 *   Asiakasnumero      er_parties.accounting_customer_no, jos kirjattu
 *   Katuosoite, Postinumero, Postitoimipaikka
 *   Vastikelaji        esim. Hoitovastike
 *   Selite             rivin selite (määrä × hinta)
 *   Määrä, Yksikköhinta, ALV %, Summa
 *   Viitenumero        kotimainen viite (yhtiön numero + järjestysnumero + tarkiste)
 *   IBAN, BIC          yhtiön tili
 */
export const BILLING_CSV_COLUMNS = [
  "Laskutusajo", "Yhtiö", "Y-tunnus", "Kausi alkaa", "Kausi päättyy", "Eräpäivä", "Huoneisto", "Maksaja", "Asiakasnumero",
  "Katuosoite", "Postinumero", "Postitoimipaikka", "Vastikelaji", "Selite", "Määrä", "Yksikköhinta", "ALV %", "Summa",
  "Viitenumero", "IBAN", "BIC",
] as const;

function cell(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\r?\n/g, " ");
  // Kaavoiksi tulkittavat alut (=, +, -, @) neutraloidaan taulukkolaskentaa varten.
  const safe = /^[=+@]/.test(v) || /^-[^\d]/.test(v) ? `'${v}` : v;
  return /[;"]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const fiNum = (v: string) => v.replace(".", ",");

export function billingRunToCsv(input: BillingRunExport): string {
  const rows = [BILLING_CSV_COLUMNS.join(";")];
  for (const l of input.lines) {
    rows.push(
      [
        input.runId, input.companyName, input.businessId, fiDate(input.periodStart), fiDate(input.periodEnd), fiDate(input.dueOn),
        l.unitLabel, l.payerName, l.payerCustomerNo, l.payerStreet, l.payerPostalCode, l.payerCity,
        CHARGE_TYPE[l.chargeType] ?? l.chargeType, l.description, fiNum(l.quantity), fiNum(l.unitPrice), fiNum(l.vatPercent), fiNum(l.amountEur),
        l.referenceNumber, input.iban, input.bic,
      ]
        .map(cell)
        .join(";"),
    );
  }
  return `﻿${rows.join("\r\n")}\r\n`;
}

export const csvAdapter: KirjanpitoAdapteri = {
  name: "csv",
  async exportBillingRun(input): Promise<ExportedFile> {
    const month = input.periodStart.slice(0, 7);
    const safeName = input.companyName.replace(/[^\wäöåÄÖÅ-]+/g, "_").slice(0, 60);
    return {
      fileName: `vastikelaskutus_${safeName}_${month}.csv`,
      mimeType: "text/csv",
      content: Buffer.from(billingRunToCsv(input), "utf8"),
    };
  },
  async importPaymentStatus({ bytes }) {
    return parsePaymentCsv(decodeCsv(bytes));
  },
};
