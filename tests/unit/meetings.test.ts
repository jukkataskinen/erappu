import { describe, expect, it } from "vitest";
import { computeVotes } from "@/lib/meetings/votes";
import { DEFAULT_AGENDA_TEMPLATES, noticeWindow, resolveAgenda } from "@/lib/meetings/templates";
import { groupOwnersForVoting } from "@/lib/meetings/attendees";
import { buildNoticeMessage, splitNoticeRecipients, type NoticeParty } from "@/lib/meetings/notice";
import { helsinkiLocalToIso, isoToHelsinkiLocal } from "@/lib/meetings/time";
import { computeMonthlyCharges } from "@/lib/certificates/charges";
import { certificatePrice, CERTIFICATE_TEMPLATE_APPROVED } from "@/lib/certificates/pricing";
import { allowRequest, resetRateLimitForTests } from "@/lib/certificates/rate-limit";

describe("äänileikkuri (AOYL 6:27 §)", () => {
  it("rajaa suurimman osakkaan viidesosaan edustetuista äänistä", () => {
    const r = computeVotes([
      { id: "iso", shares: 600, present: true },
      { id: "a", shares: 200, present: true },
      { id: "b", shares: 200, present: true },
    ]);
    expect(r.representedVotes).toBe(1000);
    expect(r.cap).toBe(200);
    expect(r.voters.find((v) => v.id === "iso")).toMatchObject({ fullVotes: 600, votes: 200, capped: true });
    expect(r.voters.find((v) => v.id === "a")).toMatchObject({ votes: 200, capped: false });
    expect(r.totalVotes).toBe(600);
  });

  it("poissaolevat eivät kasvata leikkurin pohjaa eivätkä saa ääniä", () => {
    const r = computeVotes([
      { id: "a", shares: 100, present: true },
      { id: "b", shares: 900, present: false },
    ]);
    expect(r.representedVotes).toBe(100);
    expect(r.cap).toBe(20);
    expect(r.voters.find((v) => v.id === "b")?.votes).toBe(0);
    expect(r.voters.find((v) => v.id === "a")?.votes).toBe(20);
  });

  it("raja pyöristetään alaspäin kokonaisiin ääniin", () => {
    const r = computeVotes([
      { id: "a", shares: 7, present: true },
      { id: "b", shares: 4, present: true },
    ]);
    expect(r.cap).toBe(2);
    expect(r.voters.map((v) => v.votes)).toEqual([2, 2]);
  });

  it("yhtiöjärjestys voi poistaa leikkurin tai muuttaa ääniä osaketta kohden", () => {
    const none = computeVotes([{ id: "a", shares: 900, present: true }, { id: "b", shares: 100, present: true }], { capFraction: null });
    expect(none.cap).toBeNull();
    expect(none.totalVotes).toBe(1000);
    const double = computeVotes([{ id: "a", shares: 10, present: true }], { votesPerShare: 2, capFraction: 1 });
    expect(double.voters[0].votes).toBe(20);
  });

  it("tyhjä kokous ja virheelliset parametrit", () => {
    expect(computeVotes([])).toMatchObject({ representedVotes: 0, cap: 0, totalVotes: 0 });
    expect(() => computeVotes([], { capFraction: 0 })).toThrow();
    expect(() => computeVotes([], { votesPerShare: 0 })).toThrow();
  });
});

describe("asialistapohjat", () => {
  it("varsinaisen yhtiökokouksen pohjassa ovat AOYL 6:10 §:n asiat järjestyksessä", () => {
    const titles = DEFAULT_AGENDA_TEMPLATES.annual_general.items.map((i) => i.title);
    const mustHave = [
      "Kokouksen avaus",
      "Tilinpäätös ja toimintakertomus",
      "Tuloslaskelman ja taseen vahvistaminen",
      "Vastuuvapaus hallitukselle ja isännöitsijälle",
      "Kunnossapitotarveselvitys ja hallituksen selvitys kunnossapidosta",
      "Hallituksen jäsenten ja varajäsenten valinta",
      "Tilintarkastajan tai toiminnantarkastajan valinta",
      "Kokouksen päättäminen",
    ];
    for (const t of mustHave) expect(titles).toContain(t);
    const idx = mustHave.map((t) => titles.indexOf(t));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(titles[0]).toBe("Kokouksen avaus");
    expect(titles.at(-1)).toBe("Kokouksen päättäminen");
  });

  it("kaikilla kokouslajeilla on pohja ja otsikot ovat yksilöllisiä", () => {
    for (const t of Object.values(DEFAULT_AGENDA_TEMPLATES)) {
      expect(t.items.length).toBeGreaterThan(3);
      expect(new Set(t.items.map((i) => i.title)).size).toBe(t.items.length);
    }
  });

  it("organisaation oma pohja ohittaa vakion ja tyhjät rivit karsitaan", () => {
    expect(resolveAgenda("board", [{ title: " Oma ", proposal: "x" }, { title: "", proposal: "" }])).toEqual([{ title: "Oma", proposal: "x" }]);
    expect(resolveAgenda("board", [])).toHaveLength(DEFAULT_AGENDA_TEMPLATES.board.items.length);
  });

  it("kutsuaika: aikaisintaan kaksi kuukautta, viimeistään kaksi viikkoa ennen", () => {
    expect(noticeWindow("2027-04-14T15:00:00.000Z")).toEqual({ earliest: "2027-02-13", latest: "2027-03-31" });
  });
});

describe("ääniluettelon esitäyttö", () => {
  it("yhteisomistus yhdeksi riviksi ja saman omistajan huoneistot yhteen", () => {
    const rows = groupOwnersForVoting([
      { party_id: "p1", display_name: "Maija", share_group_id: "g1", unit_label: "A 1", share_count: 100 },
      { party_id: "p2", display_name: "Matti", share_group_id: "g1", unit_label: "A 1", share_count: 100 },
      { party_id: "p3", display_name: "Olli", share_group_id: "g2", unit_label: "A 2", share_count: 50 },
      { party_id: "p3", display_name: "Olli", share_group_id: "g3", unit_label: "AP 1", share_count: 5 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ displayName: "Maija ja Matti", shares: 100, unitLabels: ["A 1"] });
    expect(rows[1]).toMatchObject({ displayName: "Olli", shares: 55 });
    expect(rows[1].shareGroupIds.sort()).toEqual(["g2", "g3"]);
  });
});

describe("kokouskutsun vastaanottajat", () => {
  const party = (id: string, email: string | null, consent: boolean): NoticeParty => ({
    party_id: id, display_name: id, email, electronic_notice_consent: consent, street_address: null, postal_code: null, city: null, unit_labels: "A 1",
  });

  it("sähköisesti vain suostumuksen antaneet, joilla on kelvollinen osoite", () => {
    const { electronic, paper } = splitNoticeRecipients([
      party("a", "a@example.test", true),
      party("b", "b@example.test", false),
      party("c", null, true),
      party("d", "ei-osoite", true),
      party("a", "a@example.test", true),
    ]);
    expect(electronic.map((p) => p.party_id)).toEqual(["a"]);
    expect(paper.map((p) => p.party_id)).toEqual(["b", "c", "d"]);
  });

  it("hallituksen kutsuun ei vaadita suostumusta", () => {
    expect(splitNoticeRecipients([party("b", "b@example.test", false)], false).electronic).toHaveLength(1);
  });

  it("viestissä on aika, paikka ja asialista mutta ei henkilötunnusta", () => {
    const m = buildNoticeMessage({
      companyName: "As Oy Testi", kind: "annual_general", startsAt: "2027-04-14T15:00:00.000Z", location: "Kerhohuone",
      remoteParticipation: true, remoteUrl: "https://example.test/k", items: [{ position: 1, title: "Kokouksen avaus" }],
      managerName: "Isa", managerEmail: "isa@example.test", managerPhone: null,
    });
    expect(m.subject).toContain("As Oy Testi");
    expect(m.body).toContain("varsinaiseen yhtiökokoukseen");
    expect(m.body).toContain("1. Kokouksen avaus");
    expect(m.body).toContain("https://example.test/k");
    expect(m.body).not.toMatch(/\d{6}[-+A]\d{3}[0-9A-Y]/);
  });
});

describe("kokousaika Helsingin ajassa", () => {
  it("talvi- ja kesäaika", () => {
    expect(helsinkiLocalToIso("2027-01-10", "18:00")).toBe("2027-01-10T16:00:00.000Z");
    expect(helsinkiLocalToIso("2027-04-14", "18:00")).toBe("2027-04-14T15:00:00.000Z");
    expect(isoToHelsinkiLocal("2027-04-14T15:00:00.000Z")).toEqual({ date: "2027-04-14", time: "18:00" });
    expect(helsinkiLocalToIso("2027-13-01", "18:00")).toBeNull();
  });
});

describe("isännöitsijäntodistuksen vastikkeet ja tilaukset", () => {
  it("laskee €/m², €/osake ja kiinteän, kulutusperusteinen ilman summaa", () => {
    const { charges, totalEur } = computeMonthlyCharges(
      [
        { charge_type: "maintenance", label: null, basis: "area_m2", unit_price: "4.2000", applies_to_kinds: null },
        { charge_type: "capital", label: null, basis: "share", unit_price: "0.1000", applies_to_kinds: ["apartment"] },
        { charge_type: "parking", label: null, basis: "fixed", unit_price: "15", applies_to_kinds: ["parking"] },
        { charge_type: "water", label: "Vesi", basis: "person", unit_price: "20", applies_to_kinds: null },
      ],
      { kind: "apartment", area_m2: "54.5", share_count: 545 },
    );
    expect(charges.map((c) => c.monthlyEur)).toEqual([228.9, 54.5, null]);
    expect(totalEur).toBe(283.4);
  });

  it("hinnat ja luonnosmerkintä", () => {
    expect(certificatePrice(false)).toBe(120);
    expect(certificatePrice(true)).toBe(180);
    expect(CERTIFICATE_TEMPLATE_APPROVED).toBe(false);
  });

  it("kutsurajoitin", () => {
    resetRateLimitForTests();
    expect(allowRequest("k", 2, 1000, 0)).toBe(true);
    expect(allowRequest("k", 2, 1000, 10)).toBe(true);
    expect(allowRequest("k", 2, 1000, 20)).toBe(false);
    expect(allowRequest("k", 2, 1000, 1500)).toBe(true);
  });
});
