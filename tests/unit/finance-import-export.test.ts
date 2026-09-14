import { describe, expect, it } from "vitest";
import { decodeCsv, matchPaymentRows, parsePaymentCsv } from "@/lib/finance/payment-import";
import { billingRunToCsv, BILLING_CSV_COLUMNS, csvAdapter } from "@/lib/finance/accounting/csv";
import { companyReference } from "@/lib/finance/references";
import { rfReference } from "@/lib/validation/finnish";

const refA1 = companyReference(12, 1);
const refA2 = companyReference(12, 2);

const candidates = [
  { shareGroupId: "g1", unitLabel: "A 1", reference: refA1 },
  { shareGroupId: "g2", unitLabel: "A 2", reference: refA2 },
  { shareGroupId: "g3", unitLabel: "B 10", reference: companyReference(12, 3) },
];

describe("maksutilanteen CSV-jäsennys", () => {
  it("BOM, puolipiste, desimaalipilkku ja tuhaterotin", () => {
    const text = `﻿Viitenumero;Asiakas;Avoin (€);Erääntynyt;Vanhin eräpäivä\r\n${refA1};Aalto Anna;"1 234,50";234,50;5.8.2026\r\n${refA2};Laine;0,00;;\r\n`;
    const r = parsePaymentCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ reference: refA1, openCents: 123450n, overdueCents: 23450n, oldestDueOn: "2026-08-05" });
    expect(r.rows[1]).toMatchObject({ openCents: 0n, overdueCents: 0n, oldestDueOn: null });
  });

  it("pilkkuerotin, pistedesimaalit ja negatiivinen saldo perässä", () => {
    const r = parsePaymentCsv(`huoneisto,avoinna,erääntyneet\nA 1,-50.00,0\nB 10,"12,00-",0\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.openCents)).toEqual([-5000n, -1200n]);
  });

  it("sarakkeiden puuttuminen ja virheelliset arvot", () => {
    expect(parsePaymentCsv("Viite;Nimi\n1;x").errors[0]).toMatch(/avoin/i);
    expect(parsePaymentCsv("Avoin;Nimi\n1;x").errors[0]).toMatch(/viitenumero tai huoneisto/i);
    const bad = parsePaymentCsv(`Viite;Avoin;Vanhin eräpäivä\n${refA1};abc;\n${refA2};10;32.1.2026\n`);
    expect(bad.rows).toHaveLength(0);
    expect(bad.errors).toHaveLength(2);
  });

  it("ohittaa yhteenvetorivin ilman viitettä ja huoneistoa", () => {
    const r = parsePaymentCsv(`Viite;Avoin\n${refA1};10,00\n;10,00\n`);
    expect(r.rows).toHaveLength(1);
  });

  it("Windows-1252-tiedosto tulkitaan oikein", () => {
    const bytes = new Uint8Array([...Buffer.from("Huoneisto;Avoin;Er", "latin1"), 0xe4, 0xe4, ...Buffer.from("ntynyt\nA 1;5,00;5,00\n", "latin1")]);
    const r = parsePaymentCsv(decodeCsv(bytes));
    expect(r.errors).toEqual([]);
    expect(r.rows[0].overdueCents).toBe(500n);
  });
});

describe("kohdistus", () => {
  it("viitteellä, RF-viitteellä ja huoneistolla; kohdistamattomat raporttiin", () => {
    const r = parsePaymentCsv(
      [
        "Viite;Huoneisto;Avoin;Erääntynyt;Vanhin eräpäivä",
        `${refA1};;100,00;50,00;5.8.2026`,
        `${refA1};;20,00;20,00;5.7.2026`,
        `${rfReference(refA2)};;30,00;0;`,
        `;b10;15,00;0;`,
        `${companyReference(99, 1)};;40,00;40,00;`,
        `120017;;1,00;0;`,
        `;C 5;2,00;0;`,
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    const m = matchPaymentRows(r.rows, candidates);
    const g1 = m.matched.find((x) => x.shareGroupId === "g1")!;
    expect(g1.openCents).toBe(12000n);
    expect(g1.overdueCents).toBe(7000n);
    expect(g1.oldestDueOn).toBe("2026-07-05");
    expect(m.matched.find((x) => x.shareGroupId === "g2")?.openCents).toBe(3000n);
    expect(m.matched.find((x) => x.shareGroupId === "g3")?.openCents).toBe(1500n);
    expect(m.unmatched.map((u) => u.reason)).toEqual([
      "Viitettä ei löydy tämän yhtiön osakeryhmistä.",
      "Viitenumero ei ole kelvollinen.",
      "Huoneistoa ei löydy yhtiöstä.",
    ]);
    expect(m.unmatched[0].open_eur).toBe("40,00");
  });
});

describe("laskutusajon CSV-vienti", () => {
  const input = {
    runId: "11111111-1111-1111-1111-111111111111",
    companyName: "As Oy Testi; Koti",
    businessId: "1234567-1",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueOn: "2026-09-05",
    iban: "FI2112345600000785",
    bic: "NDEAFIHH",
    lines: [
      {
        unitLabel: "A 1", payerName: "=Aalto \"Anna\"", payerCustomerNo: null, payerStreet: "Tie 1", payerPostalCode: "41660", payerCity: "Toivakka",
        chargeType: "maintenance", description: "Hoitovastike 72,5 m² × 3,15 €/m²/kk", quantity: "72.5000", unitPrice: "3.1500",
        amountEur: "228.38", vatPercent: "0.0", referenceNumber: refA1,
      },
    ],
  };

  it("UTF-8 BOM, puolipisteet, CRLF, suomalaiset desimaalit ja lainaukset", () => {
    const csv = billingRunToCsv(input);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header.split(";")).toEqual([...BILLING_CSV_COLUMNS]);
    expect(row).toContain('"As Oy Testi; Koti"');
    expect(row).toContain(`"'=Aalto ""Anna"""`);
    expect(row).toContain(";72,5000;3,1500;0,0;228,38;");
    expect(row).toContain(";5.9.2026;");
    expect(row.endsWith(`;${refA1};FI2112345600000785;NDEAFIHH`)).toBe(true);
  });

  it("adapteri palauttaa tiedoston", async () => {
    const f = await csvAdapter.exportBillingRun(input);
    expect(f.mimeType).toBe("text/csv");
    expect(f.fileName).toMatch(/2026-09\.csv$/);
    expect(f.content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const back = await csvAdapter.importPaymentStatus({ fileName: "x.csv", bytes: Buffer.from(`﻿Viite;Avoin\n${refA1};1,00\n`) });
    expect(back.rows[0].openCents).toBe(100n);
  });
});
