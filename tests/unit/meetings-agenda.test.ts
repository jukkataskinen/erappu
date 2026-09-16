import { describe, expect, it } from "vitest";
import { annualGeneralAgenda, auditorElectionTitle, boardElectionTitle, type CompanyGovernance } from "@/lib/meetings/agenda";

const base: CompanyGovernance = {
  boardMembersMin: 3, boardMembersMax: 3, boardDeputiesMin: 1, boardDeputiesMax: 1,
  auditorKind: "operations_auditor", auditorsCount: 1, deputyAuditorsCount: 1, isHousingCompany: true,
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
      "Päätetään hallituksen jäsenten lukumäärästä ja valitaan hallituksen jäsenet (yhtiöjärjestyksen mukaan kolme–viisi varsinaista jäsentä).",
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
    const koy = annualGeneralAgenda({ ...base, isHousingCompany: false });
    expect(koy.some((i) => i.title.includes("kunnossapitotarpeesta"))).toBe(false);
  });
});
