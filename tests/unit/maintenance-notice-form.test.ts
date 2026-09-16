import { describe, expect, it } from "vitest";
import {
  MAX_NOTICE_WORKS,
  noticeSchema,
  noticeWorkRowsFromValues,
  parseNoticeWorks,
  workSummary,
  type RawNoticeWork,
} from "@/lib/maintenance/notice-form";

const work = (over: Partial<RawNoticeWork> = {}): RawNoticeWork => ({
  work_type: "Märkätilat",
  description: "Kylpyhuoneen vedeneristys ja laatoitus uusitaan.",
  planned_start: "2026-10-01",
  planned_end: "2026-11-15",
  contractor_kind: "contractor",
  contractor_name: "Remonttipalvelu Oy",
  contractor_business_id: "1234567-1",
  contractor_contact: "Työnjohtaja 040 111 2222",
  contractor_qualification: "Sertifioitu vedeneristäjä",
  ...over,
});

const empty: RawNoticeWork = {
  work_type: "",
  description: "",
  planned_start: "",
  planned_end: "",
  contractor_kind: "",
  contractor_name: "",
  contractor_business_id: "",
  contractor_contact: "",
  contractor_qualification: "",
};

function value(result: ReturnType<typeof parseNoticeWorks>) {
  if ("error" in result) throw new Error(result.error);
  return result.value;
}

describe("muutostyöilmoituksen työrivit", () => {
  it("hyväksyy yhden työn ja siistii Y-tunnuksen", () => {
    const rows = value(parseNoticeWorks([work({ contractor_business_id: " 1234567-1 " })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workType: "Märkätilat",
      contractorKind: "contractor",
      contractorName: "Remonttipalvelu Oy",
      contractorBusinessId: "1234567-1",
      plannedStart: "2026-10-01",
      plannedEnd: "2026-11-15",
    });
  });

  it("jättää tyhjät lohkot huomiotta ja säilyttää järjestyksen", () => {
    const rows = value(parseNoticeWorks([work(), empty, work({ work_type: "Sähköjärjestelmä", description: "Pistorasiat lisätään keittiöön." }), empty]));
    expect(rows.map((r) => r.workType)).toEqual(["Märkätilat", "Sähköjärjestelmä"]);
  });

  it("vaatii vähintään yhden työn", () => {
    expect(parseNoticeWorks([empty, empty])).toEqual({ error: "Lisää vähintään yksi muutostyö." });
  });

  it("rajoittaa työrivien määrän", () => {
    const many = Array.from({ length: MAX_NOTICE_WORKS + 1 }, () => work());
    expect(parseNoticeWorks(many)).toMatchObject({ error: expect.stringContaining(`enintään ${MAX_NOTICE_WORKS}`) });
  });

  it("vaatii työlajin luettelosta", () => {
    expect(parseNoticeWorks([work({ work_type: "Sauna ja takka" })])).toEqual({ error: "Työ 1: valitse työlaji luettelosta." });
  });

  it("vaatii kuvauksen", () => {
    expect(parseNoticeWorks([work({ description: "maalaus" })])).toEqual({ error: "Työ 1: kuvaa työ tarkemmin (vähintään 10 merkkiä)." });
  });

  it("ei hyväksy valmistumista ennen aloitusta", () => {
    expect(parseNoticeWorks([work({ planned_start: "2026-10-01", planned_end: "2026-09-01" })])).toEqual({
      error: "Työ 1: valmistumispäivä ei voi olla ennen aloitusta.",
    });
  });

  it("vaatii tekijän valinnan ja virheen rivinumeron", () => {
    expect(parseNoticeWorks([work(), work({ contractor_kind: "" })])).toEqual({
      error: "Työ 2: valitse, teetkö työn itse vai teettääkö sen urakoitsija.",
    });
  });

  it("vaatii urakoitsijan nimen ja tarkistaa Y-tunnuksen", () => {
    expect(parseNoticeWorks([work({ contractor_name: "" })])).toEqual({ error: "Työ 1: kerro työn tekevän yrityksen nimi." });
    expect(parseNoticeWorks([work({ contractor_business_id: "1234567-2" })])).toEqual({ error: "Työ 1: tarkista urakoitsijan Y-tunnus." });
  });

  it("osakas itse: yrityksen kenttiä ei tallenneta, pätevyys säilyy", () => {
    const rows = value(parseNoticeWorks([work({ contractor_kind: "shareholder" })]));
    expect(rows[0]).toMatchObject({
      contractorKind: "shareholder",
      contractorName: null,
      contractorBusinessId: null,
      contractorContact: null,
      contractorQualification: "Sertifioitu vedeneristäjä",
    });
  });

  it("kokoaa rinnakkaiset kenttäjonot riveiksi", () => {
    const rows = noticeWorkRowsFromValues({
      work_type: ["Märkätilat", "Keittiö"],
      description: ["Kylpyhuoneen remontti", "Keittiön kalusteet"],
      contractor_kind: ["contractor", "shareholder"],
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ work_type: "Keittiö", contractor_kind: "shareholder" });
    // Puuttuva lohko täydentyy tyhjäksi, jotta rivit pysyvät kohdakkain.
    expect(rows[0].description).toBe("Kylpyhuoneen remontti");
    expect(noticeWorkRowsFromValues({ work_type: ["Keittiö", "Märkätilat"], description: ["vain ensimmäiselle"] })[1].description).toBe("");
  });

  it("ei kokoa enempää rivejä kuin lomakkeella on lohkoja", () => {
    const rows = noticeWorkRowsFromValues({ work_type: Array.from({ length: 12 }, () => "Keittiö") });
    expect(rows).toHaveLength(MAX_NOTICE_WORKS);
  });
});

describe("muutostyöilmoituksen lomakekentät", () => {
  const base = {
    share_group_id: "11111111-1111-4111-8111-111111111111",
    description: "Kylpyhuoneen ja keittiön remontti.",
    guide_ack: "on",
    notify_email: "on",
    notify_sms: "",
  };

  it("hyväksyy kuitatun lomakkeen ja lukee valintaruudut", () => {
    const parsed = noticeSchema.parse(base);
    expect(parsed).toMatchObject({ guide_ack: true, notify_email: true, notify_sms: false });
  });

  it("vaatii muutostyöohjeen kuittauksen", () => {
    const result = noticeSchema.safeParse({ ...base, guide_ack: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/Kuittaa muutostyöohjeen/);
  });

  it("vaatii yhteenvedon", () => {
    expect(noticeSchema.safeParse({ ...base, description: "remppa" }).success).toBe(false);
  });

  it("sallii sen, ettei osakas halua ilmoituksia", () => {
    expect(noticeSchema.parse({ ...base, notify_email: "" })).toMatchObject({ notify_email: false, notify_sms: false });
  });
});

describe("työlajien yhteenveto", () => {
  it("kertoo työlajit ja määrän", () => {
    expect(workSummary(null, 0)).toBe("Muutostyö");
    expect(workSummary("Märkätilat", 1)).toBe("Märkätilat");
    expect(workSummary("Märkätilat, Keittiö", 2)).toBe("Märkätilat ja Keittiö");
    expect(workSummary("Märkätilat, Keittiö, Sähköjärjestelmä", 3)).toBe("Märkätilat ja 2 muuta työtä");
  });
});
