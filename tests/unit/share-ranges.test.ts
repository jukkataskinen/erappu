import { describe, expect, it } from "vitest";
import { checkCoverage, countShares, formatRanges, parseShareRanges } from "@/lib/registry/share-ranges";

describe("parseShareRanges", () => {
  it("jäsentää välit ja yksittäiset numerot", () => {
    const r = parseShareRanges("1-143, 150; 200–210");
    expect(r.errors).toEqual([]);
    expect(r.ranges).toEqual([{ first: 1, last: 143 }, { first: 150, last: 150 }, { first: 200, last: 210 }]);
    expect(countShares(r.ranges)).toBe(155);
  });

  it("hylkää käänteisen välin (Accessin Veertintie 9001-1000)", () => {
    const r = parseShareRanges("9001-1000");
    expect(r.ranges).toEqual([]);
    expect(r.errors[0]).toMatch(/väärinpäin/);
  });

  it("hylkää tulkitsemattoman tekstin", () => {
    expect(parseShareRanges("A1-A5").errors).toHaveLength(1);
  });

  it("muotoilee välit järjestyksessä", () => {
    expect(formatRanges([{ first: 144, last: 241 }, { first: 1, last: 143 }, { first: 300, last: 300 }])).toBe("1–143, 144–241, 300");
  });
});

describe("checkCoverage", () => {
  it("ei havaintoja, kun välit ovat yhtenäiset ja täsmäävät", () => {
    const issues = checkCoverage(
      [
        { unitLabel: "1", ranges: [{ first: 1, last: 143 }] },
        { unitLabel: "2", ranges: [{ first: 144, last: 241 }] },
        { unitLabel: "3", ranges: [{ first: 242, last: 339 }] },
        { unitLabel: "4", ranges: [{ first: 340, last: 500 }] },
      ],
      500,
    );
    expect(issues).toEqual([]);
  });

  it("löytää Rantatuulen päällekkäisyyden", () => {
    const issues = checkCoverage(
      [
        { unitLabel: "3", ranges: [{ first: 242, last: 399 }] },
        { unitLabel: "4", ranges: [{ first: 340, last: 500 }] },
        { unitLabel: "1", ranges: [{ first: 1, last: 143 }] },
        { unitLabel: "2", ranges: [{ first: 144, last: 241 }] },
      ],
      500,
    );
    expect(issues.map((i) => i.kind)).toEqual(["overlap"]);
    expect(issues[0].message).toContain("340–399");
  });

  it("löytää aukon, puuttuvat välit ja väärän kokonaismäärän", () => {
    const issues = checkCoverage(
      [
        { unitLabel: "A1", ranges: [{ first: 1, last: 100 }] },
        { unitLabel: "A2", ranges: [{ first: 150, last: 200 }] },
        { unitLabel: "A3", ranges: [] },
      ],
      903,
    );
    expect(issues.map((i) => i.kind).sort()).toEqual(["gap", "missing", "total"]);
  });
});
