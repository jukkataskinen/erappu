import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses, validateRenovationUpdate } from "@/lib/maintenance/renovation";
import { isKnownWorkType, WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";

const base = { conditions: null, supervisor: null, supervisionCostEur: null, supervisionCostBasis: null, decidedOn: null, completedOn: null };

describe("muutostyöilmoituksen käsittely", () => {
  it("sallitut siirtymät", () => {
    expect(canTransition("received", "approved")).toBe(true);
    expect(canTransition("approved", "completed")).toBe(true);
    expect(canTransition("denied", "approved")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(nextStatuses("completed")).toEqual([]);
  });

  it("ehdoin hyväksyntä vaatii ehdot", () => {
    const r = validateRenovationUpdate("received", { ...base, status: "approved_with_conditions" }, "2026-09-15");
    expect("error" in r && r.error).toMatch(/ehdot/);
  });

  it("päätöspäivä ja valmistumispäivä täytetään tälle päivälle", () => {
    const r = validateRenovationUpdate("received", { ...base, status: "approved" }, "2026-09-15");
    expect("value" in r && r.value.decidedOn).toBe("2026-09-15");
    const c = validateRenovationUpdate("approved", { ...base, status: "completed", decidedOn: "2026-05-01" }, "2026-09-15");
    expect("value" in c && c.value.completedOn).toBe("2026-09-15");
  });

  it("valmistuminen ei voi olla ennen päätöstä", () => {
    const r = validateRenovationUpdate("approved", { ...base, status: "completed", decidedOn: "2026-05-01", completedOn: "2026-04-01" }, "2026-09-15");
    expect("error" in r).toBe(true);
  });

  it("työlajiluettelo", () => {
    expect(WORK_TYPE_LABELS).toContain("Käyttövesi- ja viemäriputket");
    expect(WORK_TYPE_LABELS.at(-1)).toBe("Muu");
    expect(isKnownWorkType("Vesikatto")).toBe(true);
    expect(isKnownWorkType("vesikatto")).toBe(false);
  });
});
