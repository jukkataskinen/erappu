import { describe, expect, it } from "vitest";
import { isActiveShareGroup, mapCompany, mapOwners, mapRestrictions, mapShareGroup, mmlConfigFromEnv, mmlHeaders, parseShareRanges, PATHS } from "@/lib/htj/mml";
import { HtjError } from "@/lib/htj/types";

// Rakenteet MML:n skeemoista ja esimerkeistä (3.9.2026). Nimet ja tunnukset kuvitteellisia, ei henkilötunnuksia.
const company = {
  ytunnus: "1234567-8",
  paatoiminimi: "Asunto Oy Esimerkki",
  yritysmuoto: { koodisto: "OIKEUDELLINEN_MUOTO", koodi: "AOY" },
  kotipaikka: { nimet: [{ kieli: "sv", nimi: "Tövsala" }, { kieli: "fi", nimi: "Toivakka" }], kuntatunnus: "850" },
  olotila: { koodisto: "OLOTILA", koodi: "1" },
  osakeluetteloOsakehuoneistorekisterissa: true,
  uusiKenttaJotaEiTunneta: 1,
};

const summary = { osakeryhmatunnus: "OHTEST0000000001", osakeryhmanimi: "A 1", osakelukumaara: 100, osakkeet: "1-100", olotila: { koodi: "1" } };
const details = { osakeryhmatunnus: "OHTEST0000000001", osakesarjat: [{ alkunumero: 1, loppunumero: 100, osakelukumaara: 100 }], hallintakohdetyyppi: { koodi: "H" } };
const premises = {
  osakeryhmatunnus: "OHTEST0000000001",
  hallintakohteet: [
    { paahallintakohde: false, hallintakohdetyyppi: { koodi: "A" }, tunnus: "AP1", pintaalat: [{ pintaala: 12 }] },
    {
      paahallintakohde: true,
      hallintakohdetyyppi: { koodi: "H" },
      tunnus: "A 1",
      paakayttotarkoitus: { kayttotarkoitus: { koodi: "1" } },
      huoneistotyyppi: "3h+k+s",
      sijaintikerros: "2",
      pintaalat: [{ pintaalanTyyppi: { koodi: "9" }, pintaala: 70 }, { pintaalanTyyppi: { koodi: "1" }, pintaala: 72.5 }],
    },
  ],
};

describe("MML-muuntimet", () => {
  it("yhtiö", () => {
    expect(mapCompany(company)).toMatchObject({ businessId: "1234567-8", name: "Asunto Oy Esimerkki", companyForm: "asunto_oy", city: "Toivakka", shareRegisterTransferred: true });
    expect(mapCompany({ ...company, yritysmuoto: { koodi: "KKOY" } }).companyForm).toBe("koy");
  });

  it("osakeryhmä: pääkohde, huoneistoala ja osakesarjat", () => {
    expect(mapShareGroup(summary, details, premises)).toEqual({
      htjId: "OHTEST0000000001", unitLabel: "A 1", ranges: [{ first: 1, last: 100 }], shareCount: 100, kind: "apartment", areaM2: 72.5,
      intendedUse: null, layout: "3h+k+s", floor: "2",
    });
    const parking = mapShareGroup({ ...summary, osakeryhmanimi: "AP 3" }, null, { hallintakohteet: [{ hallintakohdetyyppi: { koodi: "A" }, pintaalat: [] }] });
    expect(parking).toMatchObject({ kind: "parking", areaM2: null, ranges: [{ first: 1, last: 100 }] });
    expect(parseShareRanges("1-10, 21-30,41")).toEqual([{ first: 1, last: 10 }, { first: 21, last: 30 }, { first: 41, last: 41 }]);
    expect(isActiveShareGroup({ olotila: { koodi: "2" } })).toBe(false);
    expect(isActiveShareGroup({ olotila: { koodi: "3" } })).toBe(true);
  });

  it("omistajat: vain voimassa olevat, osuus, yritys ja kuolinpesä; ei henkilötunnusta", () => {
    const owners = mapOwners(
      {
        omistusoikeudet: [
          {
            omistajat: [
              { omistusosuus: { omistusosuusOsoittaja: 1, omistusosuusNimittaja: 2 }, henkilonTiedot: { etunimet: "Testi", sukunimi: "Omistaja", syntymapvm: "1970-01-01", henkilotunnus: "EI-SAA-NAKYA" }, omistusoikeudenTila: { koodi: "3" }, alkamispvm: "2023-05-17T12:09:44" },
              { omistusosuus: { omistusosuusOsoittaja: 1, omistusosuusNimittaja: 2 }, henkilonTiedot: { toiminimi: "Esimerkki Oy", ytunnus: "7654321-0" }, omistusoikeudenTila: { koodi: "3" } },
              { omistusosuus: { omistusosuusOsoittaja: 1, omistusosuusNimittaja: 1 }, henkilonTiedot: { etunimet: "Vireillä", sukunimi: "Oleva" }, omistusoikeudenTila: { koodi: "2" } },
            ],
          },
        ],
      },
      "OHTEST0000000001",
    );
    expect(owners.map((o) => [o.kind, o.name, o.shareFraction.numerator, o.shareFraction.denominator, o.startsOn])).toEqual([
      ["person", "Testi Omistaja", 1, 2, "2023-05-17"],
      ["company", "Esimerkki Oy", 1, 2, null],
    ]);
    expect(JSON.stringify(owners)).not.toContain("EI-SAA-NAKYA");
    // Sama omistaja saa saman viitteen joka haussa.
    expect(mapOwners({ omistusoikeudet: [{ omistajat: [{ henkilonTiedot: { etunimet: "Testi", sukunimi: "Omistaja", syntymapvm: "1970-01-01" } }] }] }, "X")[0].ownerRef).toBe(owners[0].ownerRef);
  });

  it("rajoitukset", () => {
    expect(mapRestrictions({ rajoitukset: [{ rajoituslaji: { koodi: "17" }, vapaaehtoinenSelite: "Lesken hallintaoikeus", alkamispvm: "2023-11-02" }] }, "G")).toEqual([
      { shareGroupHtjId: "G", kind: "17", description: "Lesken hallintaoikeus", registeredOn: "2023-11-02" },
    ]);
  });
});

describe("MML-asetukset ja polut", () => {
  it("polut teknisen kuvauksen mukaan", () => {
    expect(PATHS.company("1234567-8")).toBe("/yhtiot/1234567-8/perustiedot");
    expect(PATHS.shareGroups("1234567-8")).toBe("/yhtiot/1234567-8/osakeryhmat/suppeat-tiedot");
    expect(PATHS.owners("1234567-8", "OHX")).toBe("/yhtiot/1234567-8/osakeryhmat/OHX/omistajat-suppea");
  });

  // Isännöintitahon tunniste on järjestelmäluvituksesta saatu UUID, ei Y-tunnus
  // (HTJ Järjestelmäluvan tekninen ohje, Release-2026-05-04).
  it("isännöintitahon otsake on pakollinen ja tunniste on luvituksen UUID", () => {
    const tunniste = "e598eaff-f60e-4a6b-b275-740b7d0d6f22";
    expect(mmlHeaders({ managerBusinessId: tunniste }, "00000000-0000-0000-0000-000000000001")).toEqual({
      Accept: "application/json",
      "htj-isannointitaho": tunniste,
      "X-Request-ID": "00000000-0000-0000-0000-000000000001",
    });
    const base = { HTJ_CLIENT_CERT_BASE64: Buffer.from("c").toString("base64"), HTJ_CLIENT_KEY_BASE64: Buffer.from("k").toString("base64") };
    expect(() => mmlConfigFromEnv({ ...base } as unknown as NodeJS.ProcessEnv)).toThrow(HtjError);
    expect(() => mmlConfigFromEnv({ ...base, HTJ_ISANNOINTITAHO: "1234567-8" } as unknown as NodeJS.ProcessEnv)).toThrow(HtjError);
    expect(mmlConfigFromEnv({ ...base, HTJ_ISANNOINTITAHO: tunniste, HTJ_BASE_URL: "https://htj-ext-koe.nls.fi/htj1/isannointi/v1/" } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      baseUrl: "https://htj-ext-koe.nls.fi/htj1/isannointi/v1",
      managerBusinessId: tunniste,
    });
  });
});
