import { describe, expect, it } from "vitest";
import { boardHealth, budgetHealth, generalHealth, statementHealth, type GovernanceMeeting } from "@/lib/governance/overview";

const doc = (year: number | null) => ({ id: "d", title: "Tilinpäätös", year, created_at: "2026-03-01T10:00:00Z" });
const meeting = (starts_at: string, kind: GovernanceMeeting["kind"] = "annual_general"): GovernanceMeeting => ({ id: "m", kind, starts_at, status: "held" });
const spring = new Date("2026-04-15T09:00:00Z");
const autumn = new Date("2026-09-16T09:00:00Z");

describe("hallinto-osion tilanne", () => {
  it("talousarvio: kuluva vuosi ok, edellinen keväällä huomautus, muuten hälytys", () => {
    expect(budgetHealth(doc(2026), autumn)).toBe("ok");
    expect(budgetHealth(doc(2025), spring)).toBe("warn");
    expect(budgetHealth(doc(2025), autumn)).toBe("alert");
    expect(budgetHealth(null, autumn)).toBe("alert");
    expect(budgetHealth(doc(null), autumn)).toBe("warn");
  });

  it("tilinpäätös: edellinen tilikausi riittää", () => {
    expect(statementHealth(doc(2025), autumn)).toBe("ok");
    expect(statementHealth(doc(2024), spring)).toBe("warn");
    expect(statementHealth(doc(2024), autumn)).toBe("alert");
  });

  it("yhtiökokous: kuluvan vuoden kokous tai keväällä edellisen vuoden kokous", () => {
    expect(generalHealth(meeting("2026-05-20T15:00:00Z"), null, autumn)).toBe("ok");
    expect(generalHealth(meeting("2025-05-20T15:00:00Z"), null, spring)).toBe("warn");
    expect(generalHealth(meeting("2025-05-20T15:00:00Z"), null, autumn)).toBe("alert");
    expect(generalHealth(null, meeting("2026-05-20T15:00:00Z"), spring)).toBe("warn");
  });

  it("hallituksen kokous: alle puoli vuotta ok, alle vuosi huomautus", () => {
    expect(boardHealth(meeting("2026-06-01T15:00:00Z", "board"), null, autumn)).toBe("ok");
    expect(boardHealth(meeting("2025-12-01T15:00:00Z", "board"), null, autumn)).toBe("warn");
    expect(boardHealth(meeting("2024-12-01T15:00:00Z", "board"), null, autumn)).toBe("alert");
    expect(boardHealth(null, null, autumn)).toBe("alert");
  });
});
