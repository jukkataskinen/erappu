import { stripPersonalIds, type HtjClient } from "./client";
import {
  HtjError,
  type HtjChange,
  type HtjCompany,
  type HtjOwner,
  type HtjRestriction,
  type HtjShareGroup,
  type HtjShareGroupKind,
  type HtjSubmissionKind,
  type HtjSubmitResult,
} from "./types";

/**
 * HTJ:n jäljitelmä kehitykseen, esittelyyn ja testeihin.
 *
 * Kaikki yhtiöt, henkilöt, syntymäajat ja osoitteet ovat keksittyjä.
 * Y-tunnukset 6583621-2 ja 3058343-8 ovat Maanmittauslaitoksen
 * testiyhtiöiden tunnuksia, mutta niiden sisältö tässä on keksitty. Demon
 * yhtiöt (1000000-9, 2000000-5) vastaavat `scripts/seed-demo.mts`-dataa
 * muutamalla tarkoituksellisella erolla, jotta vertailu näyttää jotain:
 * omistajanvaihdos, jaettu omistus ja pinta-alan korjaus.
 */

export interface MockCompanyData {
  company: HtjCompany;
  shareGroups: HtjShareGroup[];
  owners: HtjOwner[];
  restrictions: HtjRestriction[];
}

export interface MockDataset {
  companies: MockCompanyData[];
  changes: HtjChange[];
}

interface UnitSpec {
  label: string;
  shares: number;
  kind?: HtjShareGroupKind;
  area?: number | null;
  layout?: string | null;
  floor?: string | null;
  use?: string | null;
}

function groups(prefix: string, units: UnitSpec[], explicitRanges?: [number, number][]): HtjShareGroup[] {
  let next = 1;
  return units.map((u, i) => {
    const [first, last] = explicitRanges?.[i] ?? [next, next + u.shares - 1];
    next = last + 1;
    const kind = u.kind ?? "apartment";
    return {
      htjId: `${prefix}-OR-${String(i + 1).padStart(3, "0")}`,
      unitLabel: u.label,
      ranges: [{ first, last }],
      shareCount: last - first + 1,
      kind,
      areaM2: u.area ?? null,
      intendedUse: u.use ?? (kind === "apartment" ? "Asuinhuoneisto" : kind === "commercial" ? "Liiketila" : kind === "parking" ? "Autopaikka" : null),
      layout: u.layout ?? null,
      floor: u.floor ?? null,
    };
  });
}

interface OwnerSpec {
  unit: string;
  first?: string;
  last?: string;
  company?: string;
  businessId?: string;
  birth?: string;
  fraction?: [number, number];
  since: string;
  address?: [string, string, string];
  protected?: boolean;
}

function owners(prefix: string, sg: HtjShareGroup[], specs: OwnerSpec[]): HtjOwner[] {
  return specs.map((s, i) => {
    const group = sg.find((g) => g.unitLabel === s.unit);
    if (!group) throw new Error(`mock: tuntematon huoneisto ${s.unit}`);
    const person = !s.company;
    const ownerRef = `${prefix}-HLO-${person ? `${s.last}-${s.first}` : s.businessId}`.replace(/\s+/g, "").toUpperCase();
    return {
      htjId: `${prefix}-OM-${String(i + 1).padStart(3, "0")}`,
      ownerRef,
      shareGroupHtjId: group.htjId,
      kind: person ? "person" : "company",
      name: person ? `${s.first} ${s.last}` : s.company!,
      firstNames: s.first ?? null,
      lastName: s.last ?? null,
      companyName: s.company ?? null,
      businessId: s.businessId ?? null,
      birthDate: person ? (s.birth ?? null) : null,
      shareFraction: { numerator: s.fraction?.[0] ?? 1, denominator: s.fraction?.[1] ?? 1 },
      startsOn: s.since,
      protected: s.protected ?? false,
      contact: s.protected || !s.address ? null : { streetAddress: s.address[0], postalCode: s.address[1], city: s.address[2], country: "FI" },
      personalId: person ? `TESTI-${ownerRef}` : undefined,
    };
  });
}

function buildDefaultDataset(): MockDataset {
  // As Oy Esimerkkirinne (demo): A 3 on myyty ja A 4 on jaettu puoliksi.
  const rinneGroups = groups("1000000-9", [
    { label: "A 1", shares: 143, area: 143, layout: "4h+k+s" },
    { label: "A 2", shares: 98, area: 98, layout: "3h+k+s" },
    { label: "A 3", shares: 98, area: 98, layout: "3h+k+s" },
    { label: "A 4", shares: 161, area: 111, layout: "3h+k+s" },
  ]);
  const rinneAddr: [string, string, string] = ["Rinnetie 4", "41660", "Toivakka"];
  const rinneOwners = owners("1000000-9", rinneGroups, [
    { unit: "A 1", first: "Paula", last: "Puheenjohtaja", birth: "1968-03-12", since: "2016-05-01", address: rinneAddr },
    { unit: "A 2", first: "Olli", last: "Osakas", birth: "1975-11-02", since: "2016-05-01", address: rinneAddr },
    { unit: "A 3", first: "Toivo", last: "Testinen", birth: "1990-06-30", since: "2026-08-15", address: ["Kuvitteellinen katu 1 B 2", "40100", "Jyväskylä"] },
    { unit: "A 4", first: "Matti", last: "Meikäläinen", birth: "1959-01-20", fraction: [1, 2], since: "2016-05-01", address: rinneAddr },
    { unit: "A 4", first: "Maija", last: "Meikäläinen", birth: "1961-09-09", fraction: [1, 2], since: "2026-06-01", protected: true },
  ]);

  // As Oy Pihlajakuja (demo): osakevälit kuten demossa, A 7 myyty ja A 10 pinta-ala korjattu.
  const pihlaRanges: [number, number][] = [];
  for (let i = 0; i < 10; i++) pihlaRanges.push([i * 79 + 1 + Math.min(i, 4), (i + 1) * 79 + Math.min(i + 1, 4)]);
  const pihlaGroups = groups(
    "2000000-5",
    Array.from({ length: 10 }, (_, i) => ({ label: `A ${i + 1}`, shares: 0, area: i === 9 ? 81 : 79.4, layout: i % 3 === 0 ? "3h+k+s" : "2h+k+s" })),
    pihlaRanges,
  );
  const pihlaNames = ["Aino", "Eero", "Helmi", "Juho", "Kerttu", "Lauri", "Mirja", "Niko", "Oona", "Pekka"];
  const pihlaOwners = owners(
    "2000000-5",
    pihlaGroups,
    pihlaNames.map((first, i) =>
      i === 6
        ? { unit: "A 7", first: "Sanni", last: "Esimerkki", birth: "1994-02-14", since: "2026-09-01", address: ["Pihlajakuja 2 A 7", "41660", "Toivakka"] as [string, string, string] }
        : { unit: `A ${i + 1}`, first, last: "Esimerkki", birth: `19${50 + i * 4}-0${(i % 9) + 1}-15`, since: "2010-01-01", address: [`Pihlajakuja 2 A ${i + 1}`, "41660", "Toivakka"] as [string, string, string] },
    ),
  );

  // MML:n testiyhtiötunnus, keksitty sisältö: 12 asuntoa, liiketila ja autopaikat.
  const kallioUnits: UnitSpec[] = [];
  for (let i = 1; i <= 12; i++) {
    const big = i % 4 === 0;
    kallioUnits.push({ label: `A ${i}`, shares: big ? 820 : 560, area: big ? 82 : 56, layout: big ? "3h+k+s" : "2h+k", floor: String(Math.ceil(i / 4)) });
  }
  kallioUnits.push({ label: "L 1", shares: 400, kind: "commercial", area: 40, floor: "1" });
  for (let i = 1; i <= 4; i++) kallioUnits.push({ label: `AP ${i}`, shares: 20, kind: "parking" });
  const kallioGroups = groups("6583621-2", kallioUnits);
  const kallioFirst = ["Ari", "Bea", "Carl", "Doris", "Elias", "Fanni", "Gabriel", "Hilma", "Iivari", "Jenna", "Kasper", "Linnea"];
  const kallioAddr = (u: string): [string, string, string] => [`Testikalliontie 3 ${u}`, "00100", "Helsinki"];
  const kallioOwners = owners("6583621-2", kallioGroups, [
    ...kallioFirst.map((first, i) => ({
      unit: `A ${i + 1}`, first, last: "Kokeilu", birth: `19${60 + i * 3}-0${(i % 9) + 1}-0${(i % 8) + 1}`, since: `20${10 + i}-03-01`,
      address: kallioAddr(`A ${i + 1}`), protected: i === 7,
    })),
    { unit: "L 1", company: "Kuvitteellinen Kahvila Oy", businessId: "0000002-7", since: "2019-10-01" },
    ...[1, 2, 3, 4].map((n) => ({ unit: `AP ${n}`, first: kallioFirst[n - 1], last: "Kokeilu", birth: `19${60 + (n - 1) * 3}-0${((n - 1) % 9) + 1}-0${((n - 1) % 8) + 1}`, since: "2015-01-01" })),
  ]);

  // MML:n testiyhtiötunnus, keksitty sisältö: viiden asunnon rivitalo ilman lainaa.
  const rantaGroups = groups("3058343-8", [
    { label: "1", shares: 100, area: 72 },
    { label: "2", shares: 100, area: 72 },
    { label: "3", shares: 120, area: 86 },
    { label: "4", shares: 100, area: 72 },
    { label: "5", shares: 80, area: 58 },
  ]);
  const rantaOwners = owners("3058343-8", rantaGroups, [
    { unit: "1", first: "Onni", last: "Harjoitus", birth: "1948-12-24", since: "1999-06-01", address: ["Rantapolku 5 1", "41660", "Toivakka"] },
    { unit: "2", first: "Siiri", last: "Harjoitus", birth: "1982-04-01", fraction: [2, 3], since: "2021-04-01", address: ["Rantapolku 5 2", "41660", "Toivakka"] },
    { unit: "2", first: "Tapio", last: "Harjoitus", birth: "1980-07-07", fraction: [1, 3], since: "2021-04-01", address: ["Rantapolku 5 2", "41660", "Toivakka"] },
    { unit: "3", first: "Ulla", last: "Esimerkkinen", birth: "1970-05-05", since: "2012-09-01", address: ["Rantapolku 5 3", "41660", "Toivakka"] },
    { unit: "4", company: "Kuvitteellinen Vuokratalot Oy", businessId: "0000003-5", since: "2018-01-01" },
    { unit: "5", first: "Veikko", last: "Kuvitelma", birth: "1955-10-10", since: "2005-02-01", address: ["Rantapolku 5 5", "41660", "Toivakka"] },
  ]);

  const company = (htjId: string, businessId: string, name: string, address: string, postal: string, city: string, total: number, form: HtjCompany["companyForm"] = "asunto_oy"): HtjCompany => ({
    htjId, businessId, name, companyForm: form, streetAddress: address, postalCode: postal, city, totalShares: total, articlesDate: null, shareRegisterTransferred: true,
  });

  return {
    companies: [
      { company: company("HTJ-YHT-1000000-9", "1000000-9", "As Oy Esimerkkirinne", "Rinnetie 4", "41660", "Toivakka", 500), shareGroups: rinneGroups, owners: rinneOwners, restrictions: [] },
      {
        company: company("HTJ-YHT-2000000-5", "2000000-5", "As Oy Pihlajakuja", "Pihlajakuja 2", "41660", "Toivakka", 794),
        shareGroups: pihlaGroups,
        owners: pihlaOwners,
        restrictions: [{ shareGroupHtjId: pihlaGroups[2].htjId, kind: "panttaus", description: "Kuvitteellinen pantinhaltija", registeredOn: "2022-05-10" }],
      },
      {
        company: company("HTJ-YHT-6583621-2", "6583621-2", "Asunto Oy Testikallio", "Testikalliontie 3", "00100", "Helsinki", kallioGroups.reduce((s, g) => s + g.shareCount, 0)),
        shareGroups: kallioGroups,
        owners: kallioOwners,
        restrictions: [],
      },
      { company: company("HTJ-YHT-3058343-8", "3058343-8", "Asunto Oy Testiranta", "Rantapolku 5", "41660", "Toivakka", 500), shareGroups: rantaGroups, owners: rantaOwners, restrictions: [] },
    ],
    changes: [
      { htjId: "MUUTOS-0001", businessId: "1000000-9", kind: "ownership", shareGroupHtjId: rinneGroups[2].htjId, occurredAt: "2026-08-15T09:12:00Z" },
      { htjId: "MUUTOS-0002", businessId: "1000000-9", kind: "ownership", shareGroupHtjId: rinneGroups[3].htjId, occurredAt: "2026-06-01T10:00:00Z" },
      { htjId: "MUUTOS-0003", businessId: "2000000-5", kind: "ownership", shareGroupHtjId: pihlaGroups[6].htjId, occurredAt: "2026-09-01T08:30:00Z" },
    ],
  };
}

export const DEFAULT_MOCK_DATASET: MockDataset = buildDefaultDataset();

/**
 * Luo jäljitelmän. Testit voivat antaa oman datan tai muokata palautetun
 * asiakkaan `dataset`-kenttää (esim. omistajanvaihdos kesken testin).
 */
export function createMockHtjClient(dataset: MockDataset = DEFAULT_MOCK_DATASET): HtjClient & { dataset: MockDataset } {
  const data: MockDataset = structuredClone(dataset);
  const find = (businessId: string) => data.companies.find((c) => c.company.businessId === businessId.trim());
  const require = (businessId: string) => {
    const c = find(businessId);
    if (!c) throw new HtjError("Yhtiötä ei löytynyt HTJ:stä.", "not_found", 404);
    return c;
  };

  return {
    mode: "mock",
    dataset: data,
    async getCompany(businessId) {
      const c = find(businessId);
      return c ? structuredClone(c.company) : null;
    },
    async listShareGroups(businessId) {
      return structuredClone(require(businessId).shareGroups);
    },
    async listOwners(businessId) {
      // Jäljitelmän "tunnus" ei ole henkilötunnuksen muotoinen, ja sekin
      // poistetaan kuten oikeassa asiakkaassa, jotta testit kattavat saman polun.
      return stripPersonalIds(structuredClone(require(businessId).owners));
    },
    async listRestrictions(businessId) {
      return structuredClone(require(businessId).restrictions);
    },
    async listChanges(since) {
      return data.changes.filter((c) => new Date(c.occurredAt) >= since).map((c) => ({ ...c }));
    },
    async submit(businessId, kind: HtjSubmissionKind, payload): Promise<HtjSubmitResult> {
      require(businessId);
      const items = (payload as { items?: { id: string }[] } | null)?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return { accepted: false, reference: null, itemRefs: {}, messages: ["Ilmoituksessa ei ole rivejä."] };
      }
      const stamp = Date.now().toString(36).toUpperCase();
      return {
        accepted: true,
        reference: `MOCK-${kind.toUpperCase()}-${stamp}`,
        itemRefs: Object.fromEntries(items.map((it, i) => [it.id, `MOCK-${kind.toUpperCase()}-${stamp}-${i + 1}`])),
        messages: [],
      };
    },
  };
}
