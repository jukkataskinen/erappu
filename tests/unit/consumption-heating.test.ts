import { describe, expect, it } from "vitest";
import { classifyHeating, heatingProfile } from "@/lib/consumption/heating";
import { parseConsumptionCsv } from "@/lib/consumption/csv";

describe("lämmitysmuoto", () => {
  it("jäsentää Accessin tekstit", () => {
    expect(classifyHeating("Suora sähkö")).toBe("direct_electric");
    expect(classifyHeating("suora sähkö")).toBe("direct_electric");
    expect(classifyHeating("kaukolämpö")).toBe("district_heat");
    expect(classifyHeating("Öljy")).toBe("oil");
    expect(classifyHeating("Maalämpö/Suora sähkö")).toBe("ground_source");
    expect(classifyHeating("")).toBeNull();
  });

  it("kaukolämmössä kaukolämpövälilehti, öljyssä öljyvälilehti", () => {
    expect(heatingProfile(["district_heat"]).heatingUtilities).toEqual(["heat"]);
    expect(heatingProfile(["oil"]).heatingUtilities).toEqual(["oil"]);
    expect(heatingProfile(["district_heat", "district_heat", "district_heat"]).note).toBeNull();
  });

  it("suorassa sähkössä ei lämmön seurantaa, koska osakas maksaa oman lämmityksensä", () => {
    const p = heatingProfile(["direct_electric", "direct_electric"]);
    expect(p.heatingUtilities).toEqual([]);
    expect(p.note).toMatch(/Jokainen osakas maksaa oman lämmityksensä/);
  });

  it("maalämmössä ei erillistä välilehteä", () => {
    const p = heatingProfile(["ground_source"]);
    expect(p.heatingUtilities).toEqual([]);
    expect(p.note).toMatch(/sisältyy sähkönkulutukseen/);
  });

  it("aiemmat lukemat pysyvät näkyvissä, ja tuntematon muoto näyttää yleisen lämpövälilehden", () => {
    expect(heatingProfile(["direct_electric"], ["heat"]).heatingUtilities).toEqual(["heat"]);
    expect(heatingProfile([null]).heatingUtilities).toEqual(["heat"]);
  });
});

describe("CSV: kaukolämpö ja öljy", () => {
  it("hyväksyy öljyn litroina ja kaukolämmön MWh:na", () => {
    const r = parseConsumptionCsv("1234567-1;öljy;1.1.2026;31.3.2026;4 200;l;5 460,00\n1234567-1;kaukolämpö;1.1.2026;31.1.2026;12,5;MWh;");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.utility, x.unit, x.amount])).toEqual([["oil", "l", 4200], ["heat", "MWh", 12.5]]);
  });

  it("hylkää öljyn kWh-yksikössä", () => {
    const r = parseConsumptionCsv("1234567-1;öljy;1.1.2026;31.3.2026;4200;kWh;");
    expect(r.errors[0].message).toMatch(/öljyn l/);
  });
});
