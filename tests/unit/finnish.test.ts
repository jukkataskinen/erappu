import { describe, expect, it } from "vitest";
import {
  birthDateFromHetu, formatReference, isValidBusinessId, isValidHetu, isValidIban, isValidReferenceNumber,
  maskHetu, normalizePropertyCode, referenceNumber, rfReference,
} from "@/lib/validation/finnish";

describe("suomalaiset tunnisteet", () => {
  it("henkilötunnus", () => {
    expect(isValidHetu("131052-308T")).toBe(true);
    expect(isValidHetu("131052-308U")).toBe(false);
    expect(birthDateFromHetu("131052-308T")).toBe("1952-10-13");
    expect(maskHetu("131052-308T")).toBe("131052-***T");
  });

  it("Y-tunnus", () => {
    expect(isValidBusinessId("2237131-2")).toBe(true);
    expect(isValidBusinessId("2237131-3")).toBe(false);
  });

  it("viitenumero 7-3-1", () => {
    expect(referenceNumber("1234")).toBe("12344");
    expect(isValidReferenceNumber("12344")).toBe(true);
    expect(isValidReferenceNumber("12345")).toBe(false);
    expect(formatReference("1000012345678")).toBe("100 00123 45678");
  });

  it("RF-viite", () => {
    // ISO 11649 -esimerkki: RF18 539007547034
    expect(rfReference("539007547034")).toBe("RF18539007547034");
  });

  it("IBAN", () => {
    expect(isValidIban("FI21 1234 5600 0007 85")).toBe(true);
    expect(isValidIban("FI21 1234 5600 0007 86")).toBe(false);
  });

  it("kiinteistötunnus", () => {
    expect(normalizePropertyCode("850-405-0005-0251")).toBe("850-405-5-251");
    expect(normalizePropertyCode("17240200040543")).toBe("172-402-4-543");
    expect(normalizePropertyCode("Paikkalankangas 5:555")).toBeNull();
  });
});
