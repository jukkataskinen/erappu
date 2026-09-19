/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/documents/render";
import { RenovationGuide } from "@/documents/RenovationGuide";
import type { Database } from "@/lib/db/types";
import { buildGuideContent, DEFAULT_GUIDE_SETTINGS, GUIDE_WORK_TYPE_KEYS, guideSettingsSchema, resolveGuideSettings } from "@/lib/maintenance/renovation-guide";
import { loadGuideCompany, renderGuidePdf, saveGuideSettings } from "@/lib/maintenance/renovation-guide-document";
import { freshDb, seedTwoOrgs, type Fixture } from "../helpers/db";

/** Yhtiökohtainen muutostyöohje (0106). */

describe("ohjeen sisältö", () => {
  const facts = { companyName: "As Oy Testi A", oldestBuildingYear: 1978, managerContact: ["Isännöitsijä Maija Manageri, puh. 040 123"] };

  it("tyhjät asetukset saavat oletukset ja kaikki työlajit", () => {
    const s = resolveGuideSettings({});
    expect(s.workTypes).toEqual(GUIDE_WORK_TYPE_KEYS);
    expect(s.workingHours).toBe(DEFAULT_GUIDE_SETTINGS.workingHours);
    expect(resolveGuideSettings({ workTypes: [] }).workTypes).toEqual([]);
    expect(resolveGuideSettings({ workTypes: ["sahko", "tuntematon", "markatilat"] }).workTypes).toEqual(["markatilat", "sahko"]);
  });

  it("vanhassa rakennuksessa on asbestiosio, uudessa ei", () => {
    const old = buildGuideContent(resolveGuideSettings({}), facts);
    expect(old.asbestos?.paragraphs[0]).toContain("vuonna 1978");
    expect(buildGuideContent(resolveGuideSettings({}), { ...facts, oldestBuildingYear: 2005 }).asbestos).toBeNull();
    expect(buildGuideContent(resolveGuideSettings({}), { ...facts, oldestBuildingYear: null }).asbestos?.paragraphs[0]).toContain("ei ole yhtiön rekisterissä");
  });

  it("yhtiökohtaiset tekstit päätyvät ohjeeseen ja lakiviittaukset ovat mukana", () => {
    const settings = resolveGuideSettings({ workTypes: ["markatilat"], processingFee: "Käsittelymaksu 50 € (hallitus 3.3.2026).", extra: "Kappale 1.\n\nKappale 2.", serviceContact: "Huolto Oy, 0400 000" });
    const c = buildGuideContent(settings, facts);
    expect(c.workTypes.map((w) => w.key)).toEqual(["markatilat"]);
    const all = JSON.stringify(c.sections);
    expect(all).toContain("Käsittelymaksu 50 €");
    expect(all).toContain("AOYL 5:7");
    expect(all).toContain("AOYL 5:4");
    expect(c.sections.find((s) => s.title === "Yhtiön lisäohjeet")?.paragraphs).toEqual(["Kappale 1.", "Kappale 2."]);
    expect(c.sections.find((s) => s.title === "Yhteystiedot")?.bullets).toEqual(["Isännöitsijä Maija Manageri, puh. 040 123", "Huolto: Huolto Oy, 0400 000"]);
  });

  it("liian pitkä teksti hylätään", () => {
    expect(guideSettingsSchema.safeParse({ ...DEFAULT_GUIDE_SETTINGS, extra: "x".repeat(4001) }).success).toBe(false);
  });

  it("PDF muodostuu luonnosmerkinnällä", async () => {
    const pdf = await renderDocumentPdf(
      <RenovationGuide data={{ approved: false, companyName: "As Oy Testi A", businessId: "1234567-8", issuedOn: "2026-09-19", content: buildGuideContent(resolveGuideSettings({}), facts) }} />,
    );
    expect(pdf.sizeBytes).toBeGreaterThan(5000);
  });
});

describe("asetukset kannassa", () => {
  let db: Database;
  let f: Fixture;

  beforeAll(async () => {
    db = await freshDb();
    f = await seedTwoOrgs(db);
    await db.asService(async (tx) => {
      await tx.query("insert into er_buildings (organization_id, company_id, label, completed_year) values ($1,$2,'A',1985), ($1,$2,'B',1992)", [f.orgA, f.companyA]);
      const [p] = await tx.query<{ id: string }>("insert into er_service_providers (organization_id, name, phone) values ($1,'Kiinteistöhuolto Esimerkki Oy','010 000 000') returning id", [f.orgA]);
      await tx.query("insert into er_company_services (organization_id, company_id, provider_id, service) values ($1,$2,$3,'Kiinteistöhuolto')", [f.orgA, f.companyA, p.id]);
    });
  });
  afterAll(async () => db.close());

  it("isännöitsijä tallentaa asetukset ja ohje käyttää niitä", async () => {
    const before = await db.asUser(f.managerA.sub, (tx) => loadGuideCompany(tx, f.companyA));
    expect(before?.oldestBuildingYear).toBe(1985);
    expect(before?.defaultServiceContact).toBe("Kiinteistöhuolto Esimerkki Oy, 010 000 000");
    expect(before?.settings.workTypes).toEqual(GUIDE_WORK_TYPE_KEYS);

    const settings = guideSettingsSchema.parse({ workTypes: ["keittio"], extra: "Yhtiökokous 2025: parvekelasitus sallittu yhtiön mallilla." });
    expect(await db.asUser(f.managerA.sub, (tx) => saveGuideSettings(tx, { companyId: f.companyA, userId: f.managerA.id, settings }))).toBe(true);
    const after = await db.asUser(f.managerA.sub, (tx) => loadGuideCompany(tx, f.companyA));
    expect(after?.settings.workTypes).toEqual(["keittio"]);
    expect(after?.settings.workingHours).toBe(DEFAULT_GUIDE_SETTINGS.workingHours);
    const pdf = await renderGuidePdf(after!, "2026-09-19");
    expect(pdf.fileName).toBe("muutostyoohje-2026-09-19.pdf");
    expect(pdf.sizeBytes).toBeGreaterThan(5000);
  });

  it("toisen organisaation isännöitsijä ei näe eikä tallenna", async () => {
    expect(await db.asUser(f.managerB.sub, (tx) => loadGuideCompany(tx, f.companyA))).toBeNull();
    const settings = guideSettingsSchema.parse({});
    expect(await db.asUser(f.managerB.sub, (tx) => saveGuideSettings(tx, { companyId: f.companyA, userId: f.managerB.id, settings }))).toBe(false);
  });
});
