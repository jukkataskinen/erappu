import { describe, expect, it } from "vitest";
import { manualPaymentText } from "@/lib/certificates/manager-certificate";

/** Isännöitsijäntodistuksen käsin tarkistettu maksutilanne (0115). */
describe("maksutilanne todistuksessa", () => {
  it("ei erääntyneitä", () => {
    expect(manualPaymentText({ overdueEur: 0, checkedOn: "2026-09-22" })).toBe("Ei erääntyneitä maksuja (tilanne 22.9.2026).");
  });
  it("erääntyneitä maksuja", () => {
    const text = manualPaymentText({ overdueEur: 276, checkedOn: "2026-09-22" });
    expect(text.startsWith("Erääntyneitä maksuja 276")).toBe(true);
    expect(text.endsWith("€ (tilanne 22.9.2026).")).toBe(true);
  });
});
