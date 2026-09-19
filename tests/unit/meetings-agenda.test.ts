import { describe, expect, it } from "vitest";
import { annualGeneralAgenda, auditorElectionTitle, boardElectionTitle, type CompanyGovernance } from "@/lib/meetings/agenda";
import { resolveGoverningAct } from "@/lib/meetings/governing-act";

const base: CompanyGovernance = {
  boardMembersMin: 3, boardMembersMax: 3, boardDeputiesMin: 1, boardDeputiesMax: 1,
  auditorKind: "operations_auditor", auditorsCount: 1, deputyAuditorsCount: 1, act: "aoyl",
};

describe("varsinaisen yhtiökokouksen esityslista yhtiöjärjestyksen mukaan", () => {
  it("Torpat: kolme varsinaista ja yksi varajäsen, yksi toiminnantarkastaja ja varahenkilö", () => {
    expect(boardElectionTitle(base)).toBe("Valitaan hallituksen jäsenet: kolme varsinaista jäsentä ja yksi varajäsen.");
    expect(auditorElectionTitle(base)).toBe("Valitaan yksi varsinainen toiminnantarkastaja ja yksi varatoiminnantarkastaja. Toiminnantarkastajan sijaan voidaan valita myös tilintarkastaja.");
  });

  it("määrät vaihtelevat: kaksi tarkastajaa, viisi jäsentä ilman varajäseniä, väli ja ehdollinen varajäsen", () => {
    expect(auditorElectionTitle({ ...base, auditorsCount: 2, deputyAuditorsCount: 2 })).toBe(
      "Valitaan kaksi varsinaista toiminnantarkastajaa ja kaksi varatoiminnantarkastajaa. Toiminnantarkastajan sijaan voidaan valita myös tilintarkastaja.",
    );
    expect(boardElectionTitle({ ...base, boardMembersMin: 5, boardMembersMax: 5, boardDeputiesMin: 0, boardDeputiesMax: 0 })).toBe("Valitaan hallituksen jäsenet: viisi varsinaista jäsentä.");
    expect(boardElectionTitle({ ...base, boardMembersMin: 3, boardMembersMax: 5, boardDeputiesMin: null, boardDeputiesMax: null })).toBe(
      "Päätetään hallituksen jäsenten lukumäärästä ja valitaan hallituksen jäsenet (yhtiöjärjestyksen mukaan 3–5 varsinaista jäsentä).",
    );
    expect(boardElectionTitle({ ...base, boardMembersMin: 1, boardMembersMax: 5, boardDeputiesMin: 0, boardDeputiesMax: 1 })).toContain("tarvittaessa enintään yksi varajäsen");
    expect(auditorElectionTitle({ ...base, auditorKind: "optional" })).toContain("ei ole pakollinen");
    expect(auditorElectionTitle({ ...base, auditorKind: "auditor", deputyAuditorsCount: 0 })).toBe("Valitaan yksi varsinainen tilintarkastaja.");
  });

  it("lista sisältää lain vaatimat selvitykset, palkkiot oikeassa muodossa ja puheenjohtajan nimen", () => {
    const items = annualGeneralAgenda({ ...base, auditorsCount: 2, deputyAuditorsCount: 2 }, { chairName: "Olavi Esimerkki" });
    const titles = items.map((i) => i.title);
    expect(titles[0]).toBe("Kokouksen avaus: hallituksen puheenjohtaja Olavi Esimerkki");
    expect(titles).toContain("Käsitellään hallituksen selvitykset kunnossapitotarpeesta ja yhtiössä tehdyistä kunnossapito- ja muutostöistä.");
    expect(titles).toContain("Päätetään hallituksen jäsenten ja toiminnantarkastajien palkkioista.");
    expect(titles.at(-1)).toBe("Kokouksen päättäminen");
    expect(titles.indexOf("Päätetään vastuuvapauden myöntämisestä hallitukselle ja isännöitsijälle päättyneen vuoden tileistä ja hallinnosta.")).toBeLessThan(
      titles.indexOf("Päätetään tilikauden tuloksen käsittelystä."),
    );
  });

  it("osakeyhtiölain alainen kiinteistöosakeyhtiö: OYL 5:3 §:n asiat, ei selvityksiä eikä äänileikkuria", () => {
    const items = annualGeneralAgenda({ ...base, act: "oyl" }, { chairName: "Olavi Esimerkki" });
    const titles = items.map((i) => i.title);
    const text = JSON.stringify(items);
    expect(titles.some((t) => t.includes("kunnossapitotarpeesta"))).toBe(false);
    expect(text).not.toContain("AOYL");
    expect(text).not.toContain("viidesosa");
    expect(text).toContain("OYL 5:12 §");
    expect(titles).toContain("Päätetään taseen osoittaman voiton käyttämisestä tai tappion käsittelystä.");
    expect(titles).toContain("Päätetään vastuuvapauden myöntämisestä hallituksen jäsenille ja toimitusjohtajalle tai isännöitsijälle.");
    expect(titles.indexOf("Päätetään tilinpäätöksen vahvistamisesta.")).toBeLessThan(titles.indexOf("Päätetään taseen osoittaman voiton käyttämisestä tai tappion käsittelystä."));
    expect(titles[0]).toBe("Kokouksen avaus: hallituksen puheenjohtaja Olavi Esimerkki");
    expect(titles.at(-1)).toBe("Kokouksen päättäminen");
  });

  it("sovellettava laki yhtiömuodosta ja valinnasta (AOYL 28:1 §)", () => {
    expect(resolveGoverningAct("asunto_oy", null)).toBe("aoyl");
    expect(resolveGoverningAct("koy", null)).toBe("aoyl");
    expect(resolveGoverningAct("koy", "oyl")).toBe("oyl");
    expect(resolveGoverningAct("other", null)).toBe("oyl");
    expect(resolveGoverningAct("other", "aoyl")).toBe("aoyl");
  });
});

describe("osakeyhtiölain alainen yhtiö muissa kokouksissa", () => {
  it("vakiopohjan ääniluettelo ilman äänileikkuria, oma pohja ennallaan", async () => {
    const { resolveAgenda } = await import("@/lib/meetings/templates");
    const oyl = JSON.stringify(resolveAgenda("extraordinary_general", null, "oyl"));
    expect(oyl).not.toContain("viidesosa");
    expect(oyl).toContain("osakeyhtiölain mukaisesti");
    expect(JSON.stringify(resolveAgenda("extraordinary_general", null))).toContain("asunto-osakeyhtiölain");
    const custom = [{ title: "Oma", proposal: "Kukaan ei voi äänestää yli viidesosalla" }];
    expect(resolveAgenda("extraordinary_general", custom, "oyl")).toEqual(custom);
  });

  it("äänileikkuri vain asunto-osakeyhtiölain alaisessa yhtiössä", async () => {
    const { computeVotes } = await import("@/lib/meetings/votes");
    const voters = [
      { id: "a", shares: 800, present: true },
      { id: "b", shares: 200, present: true },
    ];
    expect(computeVotes(voters).voters.find((v) => v.id === "a")?.capped).toBe(true);
    expect(computeVotes(voters, { capFraction: null }).voters.find((v) => v.id === "a")?.votes).toBe(800);
  });
});
