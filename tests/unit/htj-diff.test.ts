import { describe, expect, it } from "vitest";
import { companyWarnings, diffRegistry, normalizeName, SORT, type LocalOwnership, type LocalShareGroup, type OwnershipSnapshot } from "@/lib/htj/diff";
import type { HtjCompany, HtjOwner, HtjShareGroup } from "@/lib/htj/types";
import { createMockHtjClient } from "@/lib/htj/mock";

const lg = (id: string, unitLabel: string, first: number, last: number, extra: Partial<LocalShareGroup> = {}): LocalShareGroup => ({
  id, unitLabel, kind: "apartment", areaM2: 50, intendedUse: "Asuinhuoneisto", layout: null, floor: null, ranges: [{ first, last }], htjId: null, ...extra,
});
const hg = (htjId: string, unitLabel: string, first: number, last: number, extra: Partial<HtjShareGroup> = {}): HtjShareGroup => ({
  htjId, unitLabel, ranges: [{ first, last }], shareCount: last - first + 1, kind: "apartment", areaM2: 50, intendedUse: "Asuinhuoneisto", layout: null, floor: null, ...extra,
});
const lo = (id: string, shareGroupId: string, name: string, extra: Partial<LocalOwnership> = {}): LocalOwnership => ({
  id, shareGroupId, partyId: `p-${id}`, partyHtjId: null, name, numerator: 1, denominator: 1, startsOn: "2016-05-01", htjId: null, ...extra,
});
const ho = (htjId: string, shareGroupHtjId: string, first: string, last: string, extra: Partial<HtjOwner> = {}): HtjOwner => ({
  htjId, ownerRef: `REF-${last}-${first}`, shareGroupHtjId, kind: "person", name: `${first} ${last}`, firstNames: first, lastName: last, companyName: null, businessId: null,
  birthDate: "1970-01-01", shareFraction: { numerator: 1, denominator: 1 }, startsOn: "2016-05-01", contact: null, protected: false, ...extra,
});

describe("diffRegistry: osakeryhmät", () => {
  it("täsmäävä rivi, joka on jo linkitetty HTJ:hin, ei tuota eroa", () => {
    const diffs = diffRegistry(
      { shareGroups: [lg("g1", "A 1", 1, 100, { htjId: "H1" })], ownerships: [lo("o1", "g1", "Aino Esimerkki", { htjId: "OM1", partyHtjId: "REF-Esimerkki-Aino" })] },
      { shareGroups: [hg("H1", "A 1", 1, 100)], owners: [ho("OM1", "H1", "Aino", "Esimerkki")] },
    );
    expect(diffs).toEqual([]);
  });

  it("ensimmäisessä vertailussa täsmäävät rivit merkitään linkitettäviksi", () => {
    const diffs = diffRegistry(
      { shareGroups: [lg("g1", "A 1", 1, 100)], ownerships: [lo("o1", "g1", "Aino Esimerkki")] },
      { shareGroups: [hg("H1", "A1", 1, 100, { unitLabel: "A 1" })], owners: [ho("OM1", "H1", "Aino", "Esimerkki")] },
    );
    expect(diffs.map((d) => [d.entity, d.action])).toEqual([["share_group", "update"], ["ownership", "update"]]);
    expect((diffs[0].after as { linkOnly?: boolean }).linkOnly).toBe(true);
    expect((diffs[1].after as OwnershipSnapshot).linkOnly).toBe(true);
  });

  it("lisäys, muutos ja poisto", () => {
    const diffs = diffRegistry(
      {
        shareGroups: [lg("g1", "A 1", 1, 100, { htjId: "H1" }), lg("g2", "A 2", 101, 200, { htjId: "H2" }), lg("g9", "Varasto", 301, 310)],
        ownerships: [lo("o9", "g9", "Vanha Omistaja")],
      },
      { shareGroups: [hg("H1", "A 1", 1, 100), hg("H2", "A 2", 101, 200, { areaM2: 52.5 }), hg("H3", "A 3", 201, 300)], owners: [] },
    );
    const summary = diffs.map((d) => `${d.entity}:${d.action}:${d.localId ?? d.htjRef}`);
    expect(summary).toContain("share_group:update:g2");
    expect(summary).toContain("share_group:add:H3");
    expect(summary).toContain("share_group:remove:g9");
    expect(summary).toContain("ownership:remove:o9");
    expect(summary).not.toContain("share_group:update:g1");
    // Päättyvät omistukset kirjoitetaan ennen osakeryhmän poistoa ja lisäyksiä.
    expect(diffs[0].sortOrder).toBe(SORT.ownershipRemove);
    expect(diffs.at(-1)!.sortOrder).toBe(SORT.shareGroupAdd);
  });

  it("yhdistää osakevälien perusteella, kun tunnus on eri muodossa", () => {
    const diffs = diffRegistry(
      { shareGroups: [lg("g1", "1", 1, 100)], ownerships: [] },
      { shareGroups: [hg("H1", "As 1", 1, 100)], owners: [] },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ entity: "share_group", action: "update", localId: "g1", htjRef: "H1" });
  });

  it("osakevälien muutos näkyy muutoksena", () => {
    const [d] = diffRegistry({ shareGroups: [lg("g1", "A 1", 1, 100, { htjId: "H1" })], ownerships: [] }, { shareGroups: [hg("H1", "A 1", 1, 120)], owners: [] });
    expect(d.action).toBe("update");
    expect(d.label).toMatch(/muuttuvat/);
  });
});

describe("diffRegistry: omistukset", () => {
  const groupsLocal = [lg("g1", "A 3", 242, 339, { htjId: "H3" })];
  const groupsHtj = [hg("H3", "A 3", 242, 339)];

  it("omistajanvaihdos on poisto ja lisäys", () => {
    const diffs = diffRegistry(
      { shareGroups: groupsLocal, ownerships: [lo("o1", "g1", "Veera Vuokranantaja", { htjId: "OM-OLD" })] },
      { shareGroups: groupsHtj, owners: [ho("OM-NEW", "H3", "Toivo", "Testinen", { startsOn: "2026-08-15" })] },
    );
    expect(diffs.map((d) => `${d.entity}:${d.action}`)).toEqual(["ownership:remove", "ownership:add"]);
    const add = diffs[1].after as OwnershipSnapshot;
    expect(add).toMatchObject({ name: "Toivo Testinen", numerator: 1, denominator: 1, localShareGroupId: "g1", shareGroupHtjId: "H3" });
  });

  it("osuuden muutos ja uusi osaomistaja", () => {
    const diffs = diffRegistry(
      { shareGroups: groupsLocal, ownerships: [lo("o1", "g1", "Matti Meikäläinen")] },
      {
        shareGroups: groupsHtj,
        owners: [
          ho("OM1", "H3", "Matti", "Meikäläinen", { shareFraction: { numerator: 1, denominator: 2 } }),
          ho("OM2", "H3", "Maija", "Meikäläinen", { shareFraction: { numerator: 1, denominator: 2 } }),
        ],
      },
    );
    expect(diffs.map((d) => `${d.entity}:${d.action}`)).toEqual(["ownership:update", "ownership:add"]);
    expect(diffs[0].label).toMatch(/koko → 1\/2/);
  });

  it("murto-osuudet verrataan arvona (2/4 = 1/2)", () => {
    const diffs = diffRegistry(
      { shareGroups: groupsLocal, ownerships: [lo("o1", "g1", "Matti Meikäläinen", { numerator: 2, denominator: 4, htjId: "OM1", partyHtjId: "REF-Meikäläinen-Matti" })] },
      { shareGroups: groupsHtj, owners: [ho("OM1", "H3", "Matti", "Meikäläinen", { shareFraction: { numerator: 1, denominator: 2 } })] },
    );
    expect(diffs).toEqual([]);
  });

  it("nimen järjestys ja kirjainkoko eivät estä yhdistämistä", () => {
    expect(normalizeName("MEIKÄLÄINEN Matti")).toBe(normalizeName("Matti Meikäläinen"));
  });

  it("uuden osakeryhmän omistajat lisätään osakeryhmän HTJ-tunnisteella", () => {
    const diffs = diffRegistry({ shareGroups: [], ownerships: [] }, { shareGroups: [hg("H5", "B 1", 1, 50)], owners: [ho("OM5", "H5", "Onni", "Harjoitus")] });
    const add = diffs.find((d) => d.entity === "ownership")!;
    expect((add.after as OwnershipSnapshot).localShareGroupId).toBeNull();
    expect((add.after as OwnershipSnapshot).shareGroupHtjId).toBe("H5");
    expect(add.sortOrder).toBeGreaterThan(diffs.find((d) => d.entity === "share_group")!.sortOrder);
  });

  it("erot eivät sisällä syntymäaikaa, henkilötunnusta eikä turvakiellon alaista osoitetta", () => {
    const diffs = diffRegistry(
      { shareGroups: groupsLocal, ownerships: [] },
      {
        shareGroups: groupsHtj,
        owners: [
          ho("OM1", "H3", "Maija", "Meikäläinen", { protected: true, contact: { streetAddress: "Salainen 1", postalCode: "00100", city: "Helsinki", country: "FI" }, personalId: "TESTI-X" }),
        ],
      },
    );
    const json = JSON.stringify(diffs);
    expect(json).not.toContain("1970-01-01");
    expect(json).not.toContain("TESTI-X");
    expect(json).not.toContain("Salainen");
  });
});

describe("mock-HTJ", () => {
  it("demoyhtiön omistajissa ei ole henkilötunnusta edes laajassa haussa", async () => {
    const client = createMockHtjClient();
    const meta = { purpose: "registry_sync" as const, userId: null, organizationId: "x" };
    const owners = await client.listOwners("1000000-9", "wide", meta);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.every((o) => !("personalId" in o))).toBe(true);
  });

  it("yhtiötason huomiot", () => {
    const htj = { name: "As Oy Esimerkkirinne", totalShares: 500, shareRegisterTransferred: true } as HtjCompany;
    expect(companyWarnings({ name: "As Oy Esimerkkirinne", total_shares: 500 }, htj)).toEqual([]);
    expect(companyWarnings({ name: "As Oy Esimerkkirinne", total_shares: 480 }, htj)[0]).toMatch(/500/);
  });
});
