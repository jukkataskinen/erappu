import { describe, expect, it } from "vitest";
import { parseReadingsCsv, type CsvMeter } from "@/lib/water/csv";

const meters: CsvMeter[] = [
  { id: "k1", unit_label: "A 1", kind: "cold", meter_number: "12345678", removed_on: null },
  { id: "l1", unit_label: "A 1", kind: "hot", meter_number: "L-555", removed_on: null },
  { id: "k2", unit_label: "A 2", kind: "cold", meter_number: null, removed_on: null },
  { id: "old", unit_label: "A 2", kind: "cold", meter_number: "999", removed_on: "2026-03-15" },
];

describe("vesimittarilukemien CSV-tuonti", () => {
  it("tunnistaa mittarin numerosta tai huoneistosta ja tyypistä", () => {
    const r = parseReadingsCsv("﻿Mittari;Huoneisto;Tyyppi;Lukema\n12345678;A 1;kylmä;221,5\n;A1;lämmin;70,25\n;A 2;;151\n", meters);
    expect(r.errors).toEqual([]);
    expect(r.readings).toEqual([
      { meterId: "k1", value: "221.5" },
      { meterId: "l1", value: "70.25" },
      { meterId: "k2", value: "151" },
    ]);
  });

  it("pilkkuerotin, etäluennan tarkkuus pyöristetään kolmeen desimaaliin", () => {
    const r = parseReadingsCsv('meter number,reading\n"L-555",70.12345\n', meters);
    expect(r.readings).toEqual([{ meterId: "l1", value: "70.123" }]);
  });

  it("virheet: tuntematon mittari, epäselvä huoneisto, kelvoton luku, tuplarivi, poistettu mittari", () => {
    const r = parseReadingsCsv("mittari;huoneisto;tyyppi;lukema\n;A 1;;10\n111;;;5\n;A 2;kylmä;abc\n12345678;;;1\n12345678;;;2\n999;;;3\n", meters);
    expect(r.readings).toEqual([{ meterId: "k1", value: "1" }]);
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0]).toContain("useita mittareita");
    expect(r.errors[1]).toContain("ei löytynyt");
    expect(r.errors[2]).toContain("ei ole luku");
    expect(r.errors[3]).toContain("jo lukema");
    expect(r.errors[4]).toContain("999");
  });

  it("otsikkorivi on pakollinen", () => {
    expect(parseReadingsCsv("12345678;221,5\n", meters).errors[0]).toContain("otsikkorivin");
    expect(parseReadingsCsv("a;b\n1;2\n", meters).errors[0]).toContain("lukeman sarake");
    expect(parseReadingsCsv("tyyppi;lukema\nkylmä;2\n", meters).errors[0]).toContain("mittarinumeron tai huoneiston");
  });
});
