import { describe, expect, it } from "vitest";
import { assignableStaffRoles, emailsMatch, inviteUrl, isInviteTokenShaped } from "@/lib/invitations/rules";
import { integrationStatuses } from "@/lib/settings/integrations";
import { basisLabel } from "@/lib/settings/portal-users";
import { randomToken } from "@/lib/security/crypto";

describe("kutsujen säännöt", () => {
  it("pääkäyttäjäksi voi kutsua vain pääkäyttäjä", () => {
    expect(assignableStaffRoles("owner")).toContain("owner");
    expect(assignableStaffRoles("manager")).toEqual(["manager", "accountant", "assistant"]);
    expect(assignableStaffRoles("accountant")).toEqual([]);
    expect(assignableStaffRoles("assistant")).toEqual([]);
  });

  it("sähköpostit verrataan kirjainkoosta ja välilyönneistä riippumatta", () => {
    expect(emailsMatch(" Olli@Example.TEST ", "olli@example.test")).toBe(true);
    expect(emailsMatch("olli@example.test", "olli2@example.test")).toBe(false);
    expect(emailsMatch(null, "olli@example.test")).toBe(false);
    expect(emailsMatch("", "")).toBe(false);
  });

  it("token: randomToken kelpaa, muu syöte ei", () => {
    expect(isInviteTokenShaped(randomToken())).toBe(true);
    expect(isInviteTokenShaped("lyhyt")).toBe(false);
    expect(isInviteTokenShaped("a".repeat(40) + "/..")).toBe(false);
  });

  it("kutsulinkki", () => {
    expect(inviteUrl("abc", "https://erappu.fi/")).toBe("https://erappu.fi/kutsu/abc");
  });
});

describe("integraatioiden tila", () => {
  it("oletuksena jäljitelmät ja BLOCKERS-viite", () => {
    const s = integrationStatuses({});
    expect(s.map((i) => i.statusLabel)).toEqual(["Jäljitelmä", "Jäljitelmä", "Jäljitelmä", "Jäljitelmä", "Jäljitelmä"]);
    expect(s.find((i) => i.key === "HTJ_MODE")?.blocker).toMatch(/BLOCKERS 1/);
  });

  it("käytössä-tila ja tuntematonta arvoa ei kaiuteta", () => {
    const s = integrationStatuses({ HTJ_MODE: "mml", EMAIL_MODE: "sk-salainen-avain", RESEND_API_KEY: "re_123" });
    expect(s.find((i) => i.key === "HTJ_MODE")).toMatchObject({ live: true, statusLabel: "Käytössä", blocker: null });
    const email = s.find((i) => i.key === "EMAIL_MODE");
    expect(email?.mode).toBe("tuntematon");
    expect(JSON.stringify(s)).not.toContain("re_123");
    expect(JSON.stringify(s)).not.toContain("sk-salainen");
  });

  it("portaalioikeuden peruste", () => {
    expect(basisLabel("ownership:123")).toBe("Omistus");
    expect(basisLabel("board:1")).toBe("Hallitusjäsenyys");
    expect(basisLabel("x")).toBe("Muu");
  });
});
