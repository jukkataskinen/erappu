import { describe, expect, it } from "vitest";
import { getTemplate, TEMPLATES } from "@/lib/contract-templates";
import {
  addYears,
  buildValuesSchema,
  chooseRepresentative,
  companyAddress,
  fillTemplate,
  mergeValues,
  nextSeasonTitle,
  normalizeValues,
  prefillFromRegistry,
  TemplateFillError,
  validateValues,
} from "@/lib/contract-templates/render";
import { renderContractPdf } from "@/lib/contract-templates/pdf";
import { seasonEnd, SNOW_PLOUGHING } from "@/lib/contract-templates/snow-ploughing";

const t = SNOW_PLOUGHING;
const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "%PDF";

describe("sopimuspohjat", () => {
  it("rekisteri löytää pohjan ja pohjan kentät ovat yksilöllisiä", () => {
    expect(getTemplate("snow-ploughing")).toBe(SNOW_PLOUGHING);
    expect(getTemplate("ei-ole")).toBeNull();
    for (const tpl of TEMPLATES) {
      const keys = tpl.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      // Esimerkkiarvoilla täyttö ei kaadu tuntemattomaan paikkamerkkiin.
      expect(() => fillTemplate(tpl, tpl.exampleValues)).not.toThrow();
    }
  });

  it("täyttää paikkamerkit ja muotoilee kyllä/ei, päivän ja rahan", () => {
    const filled = fillTemplate(t, { ...t.exampleValues, sanding: false, price_ploughing: "1200.5" });
    const text = filled.sections.flatMap((s) => [...s.paragraphs, ...s.keyValues.map((kv) => `${kv.label}: ${kv.value}`)]).join("\n");
    expect(text).toContain("lumenaurauksen kyllä");
    expect(text).toContain("hiekoituksen ei");
    expect(text).toContain("voimassa 30.4.2027 saakka");
    expect(text).toContain("Auraus 1 200,50 euroa/kerta");
    expect(text).toContain("Tilaaja: As Oy Esimerkki, 1234567-1");
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(filled.documentTitle).toBe("Lumityösopimus Esimerkkiurakointi Oy 30.4.2027");
    expect(filled.signers.map((s) => s.roleLabel)).toEqual(["Tilaajan edustaja", "Urakoitsija"]);
    expect(filled.signers[0].email).toBe("paula@example.test");
  });

  it("tuntematon paikkamerkki kaatuu", () => {
    const broken = { ...t, sections: [{ heading: "X", paragraphs: ["{{ei_kenttaa}}"] }] };
    expect(() => fillTemplate(broken, t.exampleValues)).toThrow(TemplateFillError);
  });

  it("numerointi on juokseva ja teksti korjattu", () => {
    const filled = fillTemplate(t, t.exampleValues);
    expect(filled.sections.map((s) => s.number)).toEqual(Array.from({ length: filled.sections.length }, (_, i) => i + 1));
    expect(filled.sections).toHaveLength(11);
    expect(filled.sections[5].heading).toBe("IRTISANOMISAIKA");
    expect(filled.sections[10].heading).toBe("SOPIMUKSEN SIIRTÄMINEN");
    const all = JSON.stringify(filled);
    expect(all).not.toMatch(/Urkoitsija|urakoit-sijan|Urakoit-sija|työsuoritus-velvollisuuttaan|yrittäjän|kahtena saman sisältöisenä/);
    expect(all).toContain("Sopimus allekirjoitetaan sähköisesti, ja kumpikin sopijapuoli saa allekirjoitetun ja sinetöidyn kappaleen.");
  });

  it("puuttuvat pakolliset kentät listataan ymmärrettävästi", () => {
    const errors = validateValues(t, { ...t.exampleValues, client_representative_email: "", price_sanding: null });
    expect(errors.map((e) => e.message)).toEqual(["hiekoitus €/kerta puuttuu", "tilaajan edustajan sähköposti puuttuu"]);
    expect(validateValues(t, { ...t.exampleValues, client_representative_email: "ei-osoite" })[0].message).toBe("tilaajan edustajan sähköposti: tarkista arvo");
    expect(validateValues(t, t.exampleValues, { today: "2027-05-01" })[0].message).toBe("voimassa asti on menneisyydessä");
    expect(validateValues(t, t.exampleValues, { today: "2026-09-15" })).toEqual([]);
  });

  it("zod-skeema pohjan kentistä", () => {
    const schema = buildValuesSchema(t, "company");
    expect(schema.safeParse({ ploughing: "kyllä", sanding: "ei", client_representative: "A", client_representative_email: "A@Example.test", site_address: "x" }).success).toBe(true);
    expect(schema.safeParse({ ploughing: "kyllä", sanding: "ei", client_representative: "", client_representative_email: "a@example.test", site_address: "x" }).success).toBe(false);
    const normalized = normalizeValues(t, { price_ploughing: "45,5", ploughing: "ei", client_representative_email: " A@Example.TEST ", tuntematon: "x" }, "company");
    expect(normalized.errors).toEqual([]);
    expect(normalized.values).toEqual({ price_ploughing: "45.50", ploughing: false, client_representative_email: "a@example.test" });
  });

  it("yhtiökohtainen ylikirjoitus voittaa yhteisen, tyhjä ei", () => {
    const shared = { price_ploughing: "45.00", price_sanding: "40.00", valid_until: "2027-04-30" };
    expect(mergeValues(t, shared, { price_ploughing: "50.00", price_sanding: null }).price_ploughing).toBe("50.00");
    expect(mergeValues(t, shared, { price_ploughing: "50.00", price_sanding: null }).price_sanding).toBe("40.00");
    // Ei-ylikirjoitettavaa yhteistä kenttää ei voi muuttaa yhtiölle.
    expect(mergeValues(t, shared, { valid_until: "2030-01-01" }).valid_until).toBe("2027-04-30");
  });

  it("tilaajan edustaja: puheenjohtaja, muuten vastuuisännöitsijä", () => {
    expect(chooseRepresentative({ name: "Paula", email: "p@example.test" }, { name: "Iida", email: "i@example.test" })).toEqual({ name: "Paula", email: "p@example.test" });
    expect(chooseRepresentative(null, { name: "Iida", email: "i@example.test" })).toEqual({ name: "Iida", email: "i@example.test" });
    expect(chooseRepresentative({ name: "Paula", email: null }, null)).toEqual({ name: "Paula", email: null });
    expect(chooseRepresentative(null, { name: null, email: null })).toBeNull();
    const values = prefillFromRegistry(t, "company", {
      company: { name: "As Oy A", business_id: "1", street_address: "Rinnetie 4", postal_code: "41660", city: "Toivakka" },
      representative: { name: "Paula", email: "p@example.test" },
      provider: null,
    });
    expect(values).toEqual({ client_representative: "Paula", client_representative_email: "p@example.test", site_address: "Rinnetie 4, 41660 Toivakka" });
    expect(companyAddress({ name: "", business_id: "", street_address: null, postal_code: null, city: null })).toBeNull();
  });

  it("kauden päivät ja otsikko", () => {
    expect(seasonEnd("2026-09-15")).toBe("2027-04-30");
    expect(seasonEnd("2027-02-01")).toBe("2027-04-30");
    expect(addYears("2027-04-30", 1)).toBe("2028-04-30");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(nextSeasonTitle("Lumityösopimukset 2026–2027")).toBe("Lumityösopimukset 2027–2028");
    expect(nextSeasonTitle("Lumityöt")).toBe("Lumityöt (seuraava kausi)");
  });

  it("PDF renderöityy ja on deterministinen", async () => {
    const data = { contract: fillTemplate(t, t.exampleValues), organizationName: "Isännöinti Testi Oy", companyName: "As Oy Esimerkki", companyBusinessId: "1234567-1", issuedOn: "2026-09-15" };
    const a = await renderContractPdf(data);
    const b = await renderContractPdf(data);
    expect(isPdf(a.bytes)).toBe(true);
    expect(a.sha256).toBe(b.sha256);
    const draft = await renderContractPdf({ ...data, contract: { ...data.contract, approved: false } });
    expect(draft.sha256).not.toBe(a.sha256);
  });
});
