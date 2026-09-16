import { describe, expect, it } from "vitest";
import { renovationProgress, requestProgress } from "@/lib/progress";
import { STATUSES } from "@/lib/service-requests/labels";
import { RENOVATION_STATUS_LABEL, type RenovationStatus } from "@/lib/maintenance/renovation";

const states = (p: ReturnType<typeof requestProgress>) => p.steps.map((s) => s.state).join(",");

describe("etenemisjana", () => {
  it("muutostyö: vastaanotettu odottaa hyväksyntää, valmis täyttää kaikki", () => {
    expect(states(renovationProgress("received"))).toBe("done,current,todo,todo");
    expect(states(renovationProgress("approved_with_conditions"))).toBe("done,done,current,todo");
    expect(states(renovationProgress("completed"))).toBe("done,done,done,done");
    expect(renovationProgress("denied").ended).toContain("ei hyväksynyt");
  });

  it("huoltopyyntö: uusi, odottaa ja hylätty", () => {
    expect(states(requestProgress("new"))).toBe("current,todo,todo,todo");
    expect(states(requestProgress("waiting"))).toBe("done,done,done,current");
    expect(requestProgress("rejected").ended).not.toBeNull();
  });

  it("jokaisella tilalla on jana tai päättymisteksti", () => {
    for (const s of STATUSES) {
      const p = requestProgress(s);
      expect(p.ended !== null || p.steps.some((x) => x.state !== "todo")).toBe(true);
    }
    for (const s of Object.keys(RENOVATION_STATUS_LABEL) as RenovationStatus[]) {
      const p = renovationProgress(s);
      expect(p.ended !== null || p.steps.some((x) => x.state !== "todo")).toBe(true);
    }
  });
});
