import { describe, expect, it } from "vitest";
import { assignSequenceNumbers, companyReference, normalizeReference } from "@/lib/finance/references";
import { allocateByShares, financingChargeCents, monthsRemaining } from "@/lib/finance/loans";
import { isValidReferenceNumber, rfReference } from "@/lib/validation/finnish";

describe("vastikeviitteet", () => {
  it("yhtiön numero + kolminumeroinen järjestysnumero + tarkiste", () => {
    expect(companyReference(12, 1)).toBe("120016");
    expect(companyReference(1, 999).startsWith("1999")).toBe(true);
    for (let seq = 1; seq <= 999; seq += 37) {
      expect(isValidReferenceNumber(companyReference(4711, seq))).toBe(true);
    }
  });

  it("kaikki yhtiön viitteet ovat erilaisia", () => {
    const refs = new Set(Array.from({ length: 999 }, (_, i) => companyReference(35, i + 1)));
    expect(refs.size).toBe(999);
  });

  it("hylkää virheellisen järjestysnumeron", () => {
    expect(() => companyReference(12, 0)).toThrow();
    expect(() => companyReference(12, 1000)).toThrow();
  });

  it("järjestysnumerot ovat vakaat: uusi huoneisto ei muuta vanhoja", () => {
    const groups = [
      { id: "a10", unit_label: "A 10" },
      { id: "a2", unit_label: "A 2" },
      { id: "b1", unit_label: "B 1" },
    ];
    const first = assignSequenceNumbers(groups, new Map());
    expect(first).toEqual([{ id: "a2", seqNo: 1 }, { id: "a10", seqNo: 2 }, { id: "b1", seqNo: 3 }]);

    const existing = new Map(first.map((x) => [x.id, x.seqNo]));
    const withNew = assignSequenceNumbers([...groups, { id: "a1", unit_label: "A 1" }], existing);
    expect(withNew).toEqual([{ id: "a1", seqNo: 4 }]);
  });

  it("poistetun numeroa ei anneta uudelleen", () => {
    const existing = new Map([["x", 1], ["y", 3]]);
    expect(assignSequenceNumbers([{ id: "z", unit_label: "C 1" }], existing)).toEqual([{ id: "z", seqNo: 4 }]);
  });

  it("tunnistaa viitteen välilyönneillä, etunollilla ja RF-muodossa", () => {
    const ref = companyReference(12, 1);
    expect(normalizeReference("12 0016")).toBe(ref);
    expect(normalizeReference("000120016")).toBe(ref);
    expect(normalizeReference(rfReference(ref))).toBe(ref);
    expect(normalizeReference("120017")).toBeNull();
  });
});

describe("lainaosuudet", () => {
  const groups = [
    { id: "a1", unit_label: "A 1", share_count: 143 },
    { id: "a2", unit_label: "A 2", share_count: 98 },
    { id: "a3", unit_label: "A 3", share_count: 98 },
    { id: "b1", unit_label: "B 1", share_count: 61 },
    { id: "ap", unit_label: "AP 1", share_count: 0 },
  ];

  it("summautuu täsmälleen lainan määrään", () => {
    for (const total of [20750000n, 2897100n, 1n, 99999n, 12345679n]) {
      const shares = allocateByShares(total, groups);
      expect([...shares.values()].reduce((s, v) => s + v, 0n)).toBe(total);
      expect(shares.has("ap")).toBe(false);
    }
  });

  it("jäännössentit suurimmille osakeryhmille", () => {
    // 100,00 € / 400 osaketta: 35,75 + 24,50 + 24,50 + 15,25 = 100,00, ei jäännöstä
    const even = allocateByShares(10000n, groups);
    expect(even.get("a1")).toBe(3575n);
    // 1,00 €: 0,3575→35, 0,245→24, 24, 0,1525→15 = 98, 2 senttiä jäännöstä → A 1 ja A 2 (tasatilanne tunnuksen mukaan)
    const small = allocateByShares(100n, groups);
    expect(small.get("a1")).toBe(36n);
    expect(small.get("a2")).toBe(25n);
    expect(small.get("a3")).toBe(24n);
    expect(small.get("b1")).toBe(15n);
  });

  it("rahoitusvastike lainaosuudesta tasalyhenteisenä", () => {
    expect(monthsRemaining("2026-09-01", "2026-09-30")).toBe(1);
    expect(monthsRemaining("2026-09-01", "2027-08-31")).toBe(12);
    expect(financingChargeCents(1200000n, "2026-09-01", "2027-08-31")).toBe(100000n);
    expect(financingChargeCents(0n, "2026-09-01", "2027-08-31")).toBe(0n);
  });
});
