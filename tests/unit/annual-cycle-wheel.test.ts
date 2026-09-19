import { describe, expect, it } from "vitest";
import { buildAnnualCycle } from "@/lib/tasks/annual-cycle";
import { dateAngle, DOT_RADIUS, layoutWheel, ringOf, WHEEL_CENTER, WHEEL_RINGS } from "@/lib/tasks/wheel";

describe("vuosikello ympyränä", () => {
  it("tammikuu alkaa ylhäältä ja heinäkuu alhaalta", () => {
    expect(dateAngle("2026-01-01")).toBeCloseTo(0.48, 1);
    expect(dateAngle("2026-07-01")).toBeCloseTo(180.48, 1);
    expect(dateAngle("2026-12-31")).toBeLessThan(360);
  });

  it("luokat jaetaan kehille: hallitus ulkona, viestintä sisällä", () => {
    expect(ringOf("board_meeting")).toBe("board");
    expect(ringOf("general_meeting")).toBe("board");
    expect(ringOf("maintenance")).toBe("property");
    expect(ringOf("communication")).toBe("communication");
    const radius = Object.fromEntries(WHEEL_RINGS.map((r) => [r.key, r.radius]));
    expect(radius.board).toBeGreaterThan(radius.property);
    expect(radius.property).toBeGreaterThan(radius.communication);
  });

  it("numerointi aikajärjestyksessä ja samana päivänä olevat merkit eivät mene päällekkäin", () => {
    const markers = layoutWheel([
      { title: "Yhtiökokous", date: "2026-06-30", category: "general_meeting" },
      { title: "Järjestäytymiskokous", date: "2026-06-30", category: "board_meeting" },
      { title: "Kevättiedote", date: "2026-04-30", category: "communication" },
    ]);
    expect(markers.map((m) => [m.number, m.title])).toEqual([
      [1, "Kevättiedote"],
      [2, "Järjestäytymiskokous"],
      [3, "Yhtiökokous"],
    ]);
    const [a, b] = markers.filter((m) => m.ring === "board");
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(DOT_RADIUS * 2);
    const board = WHEEL_RINGS.find((r) => r.key === "board")!;
    expect(Math.hypot(a.x - WHEEL_CENTER, a.y - WHEEL_CENTER)).toBeCloseTo(board.radius, 0);
  });

  it("vakiovuosikellon kaikki tehtävät mahtuvat kehille erillisinä", () => {
    const cycle = buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-09-19" });
    const markers = layoutWheel(cycle.map((t) => ({ title: t.title, date: t.due_on, category: t.category })));
    expect(markers).toHaveLength(cycle.length);
    for (const ring of WHEEL_RINGS) {
      const on = markers.filter((m) => m.ring === ring.key);
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y)).toBeGreaterThanOrEqual(DOT_RADIUS * 2 - 0.5);
    }
  });
});
