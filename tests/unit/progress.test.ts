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

  // Ilmoittajalle kerrotaan, keneltä työ on tilattu (Jukka 23.9.2026).
  it("huoltopyyntö: tilaus kertoo palveluntuottajan nimen", () => {
    expect(requestProgress("ordered", "Toivakan Kiinteistöhuolto Oy").note).toBe("Työ on tilattu: Toivakan Kiinteistöhuolto Oy.");
    expect(requestProgress("in_progress", "Toivakan Kiinteistöhuolto Oy").note).toBe("Toivakan Kiinteistöhuolto Oy tekee työtä.");
    expect(requestProgress("ordered").note).toBe("Työ on tilattu korjaajalta.");
    expect(requestProgress("ordered", "   ").note).toBe("Työ on tilattu korjaajalta.");
    expect(requestProgress("in_progress").note).toBeNull();
  });

  // Palveluntuottajan lupaus näkyy ilmoittajalle janan tarkennuksessa (Jukka 23.9.2026).
  it("huoltopyyntö: lupaus kertoo, milloin työ tehdään viimeistään", () => {
    expect(requestProgress("ordered", "Toivakan Kiinteistöhuolto Oy", "2026-09-26").note).toBe(
      "Työ on tilattu: Toivakan Kiinteistöhuolto Oy. Työ tehdään viimeistään 26.9.2026.",
    );
    expect(requestProgress("in_progress", null, "2026-10-01").note).toBe("Työ tehdään viimeistään 1.10.2026.");
    expect(requestProgress("waiting", null, "2026-10-01").note).toBe("Odottaa, esimerkiksi osia tai kulkuoikeutta. Työ tehdään viimeistään 1.10.2026.");
    expect(requestProgress("received", null, "2026-09-26").note).toBe("Työ tehdään viimeistään 26.9.2026.");
    expect(requestProgress("received").note).toBeNull();
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
