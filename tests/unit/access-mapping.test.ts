import { describe, expect, it } from "vitest";
import { isCompanyName, mapUnitKind, parsePropertyCode, repairWorkType, splitPostal, toFraction } from "../../scripts/access/mapping";

describe("Access-tuonnin muunnokset", () => {
  it("omistusosuudet murtoluvuiksi", () => {
    expect(toFraction(1)).toMatchObject({ numerator: 1, denominator: 1, guessed: false });
    expect(toFraction(0.5)).toMatchObject({ numerator: 1, denominator: 2 });
    expect(toFraction(0.3333)).toMatchObject({ numerator: 1, denominator: 3 });
    expect(toFraction(0.1667)).toMatchObject({ numerator: 1, denominator: 6 });
    expect(toFraction(0.17)).toMatchObject({ numerator: 1, denominator: 6 });
    expect(toFraction(0.66)).toMatchObject({ numerator: 2, denominator: 3 });
    expect(toFraction(0.54)).toMatchObject({ numerator: 54, denominator: 100 });
    expect(toFraction(0)).toMatchObject({ numerator: 1, denominator: 1, guessed: true });
    expect(toFraction(null).guessed).toBe(true);
  });

  it("käyttötarkoitus osakeryhmän tyypiksi", () => {
    expect(mapUnitKind("Asuinhuoneisto")).toBe("apartment");
    expect(mapUnitKind("Autokatos")).toBe("parking");
    expect(mapUnitKind("Autotalli")).toBe("garage");
    expect(mapUnitKind("Liiketila")).toBe("commercial");
    expect(mapUnitKind("toimisto")).toBe("commercial");
    expect(mapUnitKind("Varasto")).toBe("storage");
  });

  it("kiinteistötunnus tekstin seasta", () => {
    expect(parsePropertyCode("Aamurusko II 850-405-0005-0563-X")).toBe("850-405-5-563");
    expect(parsePropertyCode("Toivakka 850-405-5-610")).toBe("850-405-5-610");
    expect(parsePropertyCode("Paikkalankangas 5:555")).toBeNull();
  });

  it("postinumero ja -toimipaikka", () => {
    expect(splitPostal("41660 Toivakka")).toEqual({ postal: "41660", city: "Toivakka" });
    expect(splitPostal("Toivakka")).toEqual({ postal: null, city: "Toivakka" });
  });

  it("korjauksen kohde ja yritysnimet", () => {
    expect(repairWorkType("3 - Katto")).toBe("Vesikatto");
    expect(repairWorkType("1 - LVI")).toBe("LVI (tarkennettava)");
    expect(isCompanyName("Esimerkki Oy")).toBe(true);
    expect(isCompanyName("Matti Meikäläinen")).toBe(false);
  });
});
