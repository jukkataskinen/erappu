/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/documents/render";
import { RescuePlan, riskConclusionText, type RescuePlanData } from "@/documents/RescuePlan";
import { emptyContent, HAZARD_TEMPLATES, parseContent, PLAN_SECTIONS } from "@/lib/rescue-plans/content";
import { contentFromForm, hazardsForForm } from "@/lib/rescue-plans/form";
import { buildPrefill, nextReviewDate, refreshFromRegistry, residentsEstimate } from "@/lib/rescue-plans/prefill";
import type { RegistrySnapshot } from "@/lib/rescue-plans/registry";
import { rescuePlanStatus } from "@/lib/registry/company-modules";

/** Kuvitteellinen rekisteri. Ei oikeita henkilö- tai yhtiötietoja. */
const snapshot: RegistrySnapshot = {
  company: {
    name: "As Oy Kuvitteellinen", business_id: "1234567-1", street_address: "Testitie 1", postal_code: "41660", city: "Toivakka",
    property_maintenance: null, parking_hall_spaces: null, parking_other_spaces: 6,
  },
  organization: { name: "Isännöinti Testi Oy", phone: "010 000 0000", email: "toimisto@example.test" },
  manager: { name: "Isa Isännöitsijä", email: "isa@example.test", phone: null },
  chair: { name: "Paula Puheenjohtaja", email: null, phone: "040 000 0000" },
  propertyCodes: ["850-405-5-900"],
  parkingBuilt: 6,
  buildings: [
    {
      label: "A", building_type: "Rivitalo", completed_year: 1992, floors: 1, staircases: null, elevators: 0, construction_material: "Puu",
      roof_type: "Harjakatto", roof_material: "Pelti", heating: "Kaukolämpö", heating_type: "district_heat", heat_distribution: "Vesikiertoinen patterilämmitys",
      ventilation: "Koneellinen poisto", floor_area_m2: "520", common_spaces: ["sauna", "pesutupa"],
    },
    {
      label: "B", building_type: "Rivitalo", completed_year: 1992, floors: 1, staircases: null, elevators: 0, construction_material: "Puu",
      roof_type: null, roof_material: null, heating: "Kaukolämpö", heating_type: "district_heat", heat_distribution: "Vesikiertoinen patterilämmitys",
      ventilation: "Koneellinen poisto", floor_area_m2: null, common_spaces: ["sauna", "ulkoiluvälinevarasto"],
    },
  ],
  units: { apartments: 10, commercial: 0, parking: 0, storage: 0, other: 0 },
  residents: 0,
  maintenanceProviders: [{ name: "Esimerkkihuolto Oy", phone: "040 000 0001", emergency_phone: "040 000 0002", email: null, service: "kiinteistöhuolto" }],
};

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "%PDF";

/** Kerää asiakirjan elementtipuusta osioiden tunnisteet renderöimättä. */
function sectionKeys(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => sectionKeys(n, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<{ id?: string; children?: ReactNode }>;
  if (typeof el.type === "function" && el.type.name === "Section" && el.props.id) out.push(el.props.id);
  sectionKeys(el.props.children, out);
  return out;
}

describe("pelastussuunnitelman esitäyttö", () => {
  it("täyttää perustiedot, yhteystiedot ja vakiotekstit rekisteristä", () => {
    const c = buildPrefill(snapshot);
    expect(c.companyName).toBe("As Oy Kuvitteellinen");
    expect(c.address).toBe("Testitie 1, 41660 Toivakka");
    expect(c.propertyCodes).toBe("850-405-5-900");
    expect(c.apartments).toBe("10 asuinhuoneistoa, 1-kerroksinen");
    expect(c.residentsEstimate).toBe("noin 20 (arvio)");
    expect(c.heating).toBe("Kaukolämpö, Vesikiertoinen patterilämmitys");
    expect(c.commonSpaces).toBe("sauna, pesutupa, ulkoiluvälinevarasto");
    expect(c.buildings).toHaveLength(2);
    expect(c.buildings[0]).toMatchObject({ label: "A", completedYear: "1992", material: "Puu, Harjakatto / Pelti" });
    expect(c.managerName).toBe("Isa Isännöitsijä");
    expect(c.managerPhone).toBe("010 000 0000");
    expect(c.chairName).toBe("Paula Puheenjohtaja");
    expect(c.maintenanceName).toBe("Esimerkkihuolto Oy");
    expect(c.maintenanceEmergencyPhone).toBe("040 000 0002");
    expect(c.hazards.map((h) => h.key)).toEqual(HAZARD_TEMPLATES.map((h) => h.key));
    expect(c.hazards.find((h) => h.key === "parking_charging")?.selected).toBe(true);
    expect(c.smokeAlarms).toContain("17 §");
    expect(c.shelter).toBe("unknown");
  });

  it("jättää autopaikkojen vaaratilanteen pois, jos autopaikkoja ei ole", () => {
    const c = buildPrefill({ ...snapshot, parkingBuilt: null, company: { ...snapshot.company, parking_other_spaces: null } });
    expect(c.hazards.find((h) => h.key === "parking_charging")?.selected).toBe(false);
  });

  it("asukasmäärä rekisteristä, muuten arvio", () => {
    expect(residentsEstimate({ residents: 17, units: snapshot.units })).toBe("noin 17");
    expect(residentsEstimate({ residents: 0, units: { ...snapshot.units, apartments: 0 } })).toBe("");
  });

  it("päivitys rekisteristä ei hävitä käsin kirjoitettuja kenttiä", () => {
    const edited = { ...buildPrefill(snapshot), assemblyPoint: "Jätekatoksen edessä", managerName: "Vanha nimi" };
    const refreshed = refreshFromRegistry(edited, { ...snapshot, chair: null });
    expect(refreshed.assemblyPoint).toBe("Jätekatoksen edessä");
    expect(refreshed.managerName).toBe("Isa Isännöitsijä");
    expect(refreshed.chairName).toBe("");
  });

  it("seuraava tarkistus vuoden päähän, karkauspäivä helmikuun loppuun", () => {
    expect(nextReviewDate("2026-09-15")).toBe("2027-09-15");
    expect(nextReviewDate("2028-02-29")).toBe("2029-02-28");
  });
});

describe("lomakkeen muunnos", () => {
  it("rakennukset, vaaratilanteet, omat lisäykset ja liitteet", () => {
    const attachment = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const form: Record<string, string> = {
      companyName: "As Oy Kuvitteellinen",
      assemblyPoint: "Piha",
      shelter: "none",
      building_count: "2",
      b0_label: "A", b0_type: "Rivitalo",
      b1_label: "", b1_type: "",
      hazard_count: "3",
      h0_key: "water_damage", h0_title: "Vesivahinko", h0_selected: "on", h0_level: "4", h0_prevention: "Kosteushälyttimet", h0_custom: "0",
      h1_key: "storm", h1_title: "Myrsky", h1_level: "9", h1_custom: "0",
      h2_key: "", h2_title: "Routavauriot pihassa", h2_selected: "on", h2_level: "1", h2_custom: "1",
      [`att_${attachment}`]: "on",
      [`att_${other}`]: "off",
      boardApprovedOn: "ei päivä",
    };
    const c = contentFromForm(form, [attachment, other]);
    expect(c.buildings).toEqual([{ label: "A", type: "Rivitalo", completedYear: "", floors: "", material: "", heating: "", ventilation: "" }]);
    expect(c.hazards).toHaveLength(3);
    expect(c.hazards[0]).toMatchObject({ key: "water_damage", selected: true, level: 4, custom: false });
    expect(c.hazards[1]).toMatchObject({ key: "storm", selected: false, level: 2 });
    expect(c.hazards[2]).toMatchObject({ key: "custom_1", title: "Routavauriot pihassa", custom: true });
    expect(c.shelter).toBe("none");
    expect(c.attachmentDocumentIds).toEqual([attachment]);
    expect(c.boardApprovedOn).toBe("");
  });

  it("ei hyväksy tuntemattomia liitteitä eikä liian pitkää tekstiä", () => {
    expect(contentFromForm({ att_x: "on" }, []).attachmentDocumentIds).toEqual([]);
    expect(() => contentFromForm({ assemblyPoint: "x".repeat(301) }, [])).toThrow("Teksti on liian pitkä.");
  });

  it("lomakkeelle tulevat myös pohjan uudet vaaratilanteet valitsematta", () => {
    const content = { ...emptyContent(), hazards: [{ key: "storm", title: "Myrsky", selected: true, consequence: "", level: 2, prevention: "", custom: false }] };
    const rows = hazardsForForm(content);
    expect(rows[0].key).toBe("storm");
    expect(rows).toHaveLength(HAZARD_TEMPLATES.length);
    expect(rows.filter((r) => r.selected)).toHaveLength(1);
  });

  it("tallennettu sisältö luetaan sietävästi", () => {
    const c = parseContent({ companyName: "X", shelter: "tuntematon", hazards: "rikki" });
    expect(c.companyName).toBe("X");
    expect(c.shelter).toBe("unknown");
    expect(c.hazards).toEqual([]);
    expect(parseContent(null).companyName).toBe("");
  });
});

describe("pelastussuunnitelman tila yhtiön kortissa", () => {
  it("myöhässä, lähestyy, voimassa ja puuttuu", () => {
    expect(rescuePlanStatus(null, false, "2026-09-15")).toEqual({ text: "Ei suunnitelmaa", tone: "warn" });
    expect(rescuePlanStatus(null, true, "2026-09-15").text).toBe("Luonnos kesken");
    expect(rescuePlanStatus("2026-09-01", false, "2026-09-15").tone).toBe("alert");
    expect(rescuePlanStatus("2026-10-20", false, "2026-09-15").tone).toBe("warn");
    expect(rescuePlanStatus("2027-09-15", false, "2026-09-15").tone).toBe("ok");
  });
});

describe("pelastussuunnitelman PDF", () => {
  const data: RescuePlanData = {
    approved: false,
    status: "final",
    organizationName: "Isännöinti Testi Oy",
    businessId: "1234567-1",
    version: 2,
    preparedOn: "2026-09-15",
    nextReviewOn: "2027-09-15",
    issuedOn: "2026-09-15",
    legalBasis: "Pelastuslaki 379/2011 14–15 §",
    content: { ...buildPrefill(snapshot), assemblyPoint: "Jätekatoksen edessä", shelter: "none", safetyPersons: "Turvallisuusvastaava Testi Henkilö" },
    attachments: [
      { number: 1, title: "Asemapiirros", pages: 1, status: "attached" },
      { number: 2, title: "Vanha pohjakuva", pages: null, status: "failed", reason: "PDF on suojattu" },
    ],
  };

  it("sisältää kaikki osiot järjestyksessä", () => {
    const tree = RescuePlan({ data });
    expect(sectionKeys(tree)).toEqual(PLAN_SECTIONS.map((s) => s.key));
  });

  it("renderöityy PDF:ksi, jossa on sivuja, ja on deterministinen", async () => {
    const a = await renderDocumentPdf(<RescuePlan data={data} />);
    const b = await renderDocumentPdf(<RescuePlan data={data} />);
    expect(isPdf(a.bytes)).toBe(true);
    expect(a.sha256).toBe(b.sha256);
    const pages = (await PDFDocument.load(a.bytes)).getPageCount();
    expect(pages).toBeGreaterThan(1);
  });

  it("luonnos ja tyhjä sisältö eivät kaada renderöintiä", async () => {
    const empty = await renderDocumentPdf(<RescuePlan data={{ ...data, status: "draft", preparedOn: null, nextReviewOn: null, content: emptyContent(), attachments: [] }} />);
    expect((await PDFDocument.load(empty.bytes)).getPageCount()).toBeGreaterThan(0);
  });

  it("riskien johtopäätös kootaan suurimmista riskitasoista", () => {
    const content = { ...emptyContent(), hazards: [
      { key: "a", title: "Vesivahinko", selected: true, consequence: "", level: 3, prevention: "", custom: false },
      { key: "b", title: "Myrsky", selected: true, consequence: "", level: 2, prevention: "", custom: false },
      { key: "c", title: "Tulipalo", selected: false, consequence: "", level: 5, prevention: "", custom: false },
    ] };
    expect(riskConclusionText(content)).toContain("taso 3, kohtalainen) arvioitiin vesivahinko");
    expect(riskConclusionText({ ...content, riskConclusions: "Oma teksti" })).toBe("Oma teksti");
  });
});
