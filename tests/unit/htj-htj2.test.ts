import { describe, expect, it } from "vitest";
import { buildPayload, findGaps, obligationFor, reportState, unsubmittedRows, type Htj2Data } from "@/lib/htj/htj2";

function data(overrides: Partial<Htj2Data> = {}): Htj2Data {
  return {
    company: { id: "c", organization_id: "o", name: "As Oy Testi", business_id: "1000000-9", company_form: "asunto_oy", street_address: null, postal_code: null, city: null, total_shares: 300, htj_synced_at: null },
    groups: [
      { id: "g1", unit_label: "A 1", kind: "apartment", area_m2: "50.0", share_count: 100, htj_id: null },
      { id: "g2", unit_label: "A 2", kind: "apartment", area_m2: "50.0", share_count: 100, htj_id: null },
      { id: "g3", unit_label: "AP 1", kind: "parking", area_m2: null, share_count: 100, htj_id: null },
    ],
    charges: [{ id: "ch1", charge_type: "maintenance", label: null, basis: "area_m2", unit_price: "3.0000", starts_on: "2025-07-01", ends_on: null, decided_on: "2025-04-20", htj_charge_type: "hoitovastike", htj_submitted_at: null }],
    loans: [{ id: "l1", name: "Kattolaina", lender: "Pankki", principal_eur: "120000.00", drawn_on: "2023-10-31", due_on: "2038-10-31", interest_terms: null, undrawn_eur: "0.00", balance_eur: "96000.00", balance_date: "2025-12-31", allocated: true, htj_id: null, htj_submitted_at: null }],
    loanShares: [
      { id: "s1", loan_id: "l1", share_group_id: "g1", unit_label: "A 1", group_htj_id: null, original_eur: "60000.00", remaining_eur: "48000.00", balance_date: "2025-12-31", paid_off_on: null, htj_submitted_at: null },
      { id: "s2", loan_id: "l1", share_group_id: "g2", unit_label: "A 2", group_htj_id: null, original_eur: "60000.00", remaining_eur: "48000.00", balance_date: "2025-12-31", paid_off_on: null, htj_submitted_at: "2026-09-01" },
    ],
    works: [{ id: "w1", project: "Vesikatto", work_type: "Vesikatto", completed_year: 2024, completed_on: null, performed_by: "company", unit_label: null, htj_id: null, htj_submitted_at: null }],
    needs: [{ id: "n1", planned_year: 2027, target: "Julkisivut", action: "Maalaus", work_type: "Julkisivu", estimate_eur: "28000.00", affects_residents: false, status: "planned", htj_submitted_at: null }],
    today: "2026-09-15",
    year: 2026,
    ...overrides,
  };
}

describe("HTJ2-puutteet", () => {
  it("täydellinen yhtiö ei tuota puutteita", () => {
    expect(findGaps(data())).toEqual([]);
  });

  it("puuttuva hoitovastike, pinta-ala, lainaosuus ja KPTS", () => {
    const d = data({
      charges: [{ ...data().charges[0], htj_charge_type: null }],
      groups: [...data().groups.slice(0, 1), { ...data().groups[1], area_m2: null }, data().groups[2]],
      loanShares: [data().loanShares[0]],
      needs: [],
      works: [{ ...data().works[0], completed_year: null, work_type: "Kattojuttu" }],
    });
    const messages = findGaps(d).map((g) => g.message).join("\n");
    expect(messages).toMatch(/hoitovastike puuttuu/);
    expect(messages).toMatch(/HTJ-vastikelaji/);
    expect(messages).toMatch(/Pinta-ala puuttuu.*A 2/);
    expect(messages).toMatch(/puuttuu lainaosuus: A 2/);
    expect(messages).toMatch(/valmistumisvuosi/);
    expect(messages).toMatch(/työlaji ei ole luettelossa/);
    expect(messages).toMatch(/Kunnossapitotarveselvitys vuosille 2026–2031 puuttuu/);
  });

  it("päättynyt hoitovastike ei kelpaa voimassa olevaksi", () => {
    const d = data({ charges: [{ ...data().charges[0], starts_on: "2027-01-01" }] });
    expect(findGaps(d).some((g) => g.area === "charges" && g.severity === "alert")).toBe(true);
  });
});

describe("HTJ2-ilmoitusten sisältö", () => {
  it("vain ilmoittamattomat rivit ja ei henkilötietoja", () => {
    const d = data();
    expect(unsubmittedRows(d).loan_shares.map((r) => r.id)).toEqual(["s1"]);
    const payload = buildPayload("loan_shares", d);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: "s1", unitLabel: "A 1", remainingEur: 48000 });
    const charges = buildPayload("charges", d);
    expect(charges.items[0]).toMatchObject({ htjChargeType: "hoitovastike", unitPrice: 3, unit: "€/m²/kk", decidedOn: "2025-04-20" });
  });

  it("velvollisuus lasketaan yhtiön riveistä (autopaikka ei ole huoneisto)", () => {
    const o = obligationFor(data());
    expect(o.unitCount).toBe(2);
    expect(o.level).toBe("mandatory");
    expect(obligationFor(data({ loans: [] })).level).toBe("voluntary");
  });
});

describe("ilmoitusten tila", () => {
  it("tilojen päättely", () => {
    expect(reportState([])).toBe("not_started");
    expect(reportState([{ status: "accepted", created_at: "2026-09-01" }, { status: "draft", created_at: "2026-09-02" }])).toBe("draft");
    expect(reportState([{ status: "accepted", created_at: "2026-09-01" }])).toBe("sent");
    expect(reportState([{ status: "accepted", created_at: "2026-09-01" }, { status: "manual_done", created_at: "2026-09-10" }])).toBe("manual_done");
  });
});
