import { describe, expect, it } from "vitest";
import { boardHealth, budgetHealth, generalHealth, latestMeeting, minutesDate, minutesKind, statementHealth, type GovernanceMeeting, type LastMeeting } from "@/lib/governance/overview";

const doc = (year: number | null) => ({ id: "d", title: "Tilinpäätös", year, created_at: "2026-03-01T10:00:00Z" });
const raw = (starts_at: string, kind: GovernanceMeeting["kind"] = "annual_general"): GovernanceMeeting => ({ id: "m", kind, starts_at, status: "held" });
const meeting = (starts_at: string, kind: GovernanceMeeting["kind"] = "annual_general"): LastMeeting => ({ source: "meeting", ...raw(starts_at, kind) });
const minutes = (title: string, year: number | null = 2026, created_at = "2026-09-16T05:00:00Z") => ({ id: title, company_id: "c", title, file_name: "", year, created_at });
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
    expect(generalHealth(null, raw("2026-05-20T15:00:00Z"), spring)).toBe("warn");
  });

  it("hallituksen kokous: alle puoli vuotta ok, alle vuosi huomautus", () => {
    expect(boardHealth(meeting("2026-06-01T15:00:00Z", "board"), null, autumn)).toBe("ok");
    expect(boardHealth(meeting("2025-12-01T15:00:00Z", "board"), null, autumn)).toBe("warn");
    expect(boardHealth(meeting("2024-12-01T15:00:00Z", "board"), null, autumn)).toBe("alert");
    expect(boardHealth(null, null, autumn)).toBe("alert");
  });

  it("pöytäkirjadokumentit: tyyppi ja päivä nimestä", () => {
    expect(minutesKind("yhtiökokous 2026 yhtiokokous_2026.pdf")).toBe("general");
    expect(minutesKind("Hallitus 1  2026")).toBe("board");
    expect(minutesKind("Hallituksen kokous 20260305")).toBe("board");
    expect(minutesKind("Kokous")).toBeNull();
    expect(minutesDate("Hallituksen kokous 20260305")).toBe("2026-03-05");
    expect(minutesDate("pk 29.5.2026.pdf")).toBe("2026-05-29");
    expect(minutesDate("Hallitus 1 2026")).toBeNull();
  });

  it("uusin kokous valitaan kokouksista ja pöytäkirjoista", () => {
    const docs = [minutes("Hallituksen kokous 20260305"), minutes("Hallituksen kokous 20260529"), minutes("Yhtiökokous 20260529")];
    const board = latestMeeting(raw("2026-01-10T15:00:00Z", "board"), docs, "board");
    expect(board?.source === "document" ? board.date : null).toBe("2026-05-29");
    expect(latestMeeting(raw("2026-06-10T15:00:00Z"), docs, "general")?.source).toBe("meeting");
    const undated = latestMeeting(null, [minutes("Hallitus 1 2026", 2026, "2026-09-16T05:00:00Z"), minutes("hallitus 2 2026", 2026, "2026-09-16T06:00:00Z")], "board");
    expect(undated?.source === "document" ? undated.title : null).toBe("hallitus 2 2026");
    expect(boardHealth(undated, null, autumn)).toBe("ok");
    expect(generalHealth(latestMeeting(null, [minutes("yhtiökokous 2026")], "general"), null, autumn)).toBe("ok");
  });
});
