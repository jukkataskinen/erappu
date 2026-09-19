import { describe, expect, it } from "vitest";
import { announcementDraft, DRAFT_KEYS, hasPlaceholders, isDraftKey } from "@/lib/announcements/drafts";
import { buildAnnualCycle } from "@/lib/tasks/annual-cycle";

describe("tiedoteluonnokset vuosikellosta", () => {
  it("jokaiselle asukasviestinnän vakiotehtävälle on pohja", () => {
    const keys = buildAnnualCycle({ fiscalYearStart: "01-01", today: "2026-09-19" })
      .filter((t) => t.category === "communication")
      .map((t) => t.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(isDraftKey(k)).toBe(true);
    expect(isDraftKey("general_meeting")).toBe(false);
    expect(isDraftKey(null)).toBe(false);
  });

  it("pohjissa on täydennettävät kohdat ja allekirjoitus", () => {
    for (const k of DRAFT_KEYS) {
      const d = announcementDraft(k, { year: 2027, managerName: "Maija Manageri" });
      expect(d.title).toContain("2027");
      expect(hasPlaceholders(d.body)).toBe(true);
      expect(d.body).toContain("Maija Manageri\nisännöitsijä");
    }
    expect(announcementDraft("communication_winter", { year: 2027, managerName: null }).body).toMatch(/Terveisin\nisännöinti$/);
  });

  it("hakasulkeiden tunnistus", () => {
    expect(hasPlaceholders("Talkoot [päivä] klo 10")).toBe(true);
    expect(hasPlaceholders("Talkoot la 3.5. klo 10")).toBe(false);
    expect(hasPlaceholders("Linkki [\n]")).toBe(false);
  });
});
