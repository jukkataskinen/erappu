/**
 * Osakenumerovälien jäsennys ja tarkistus.
 *
 * Accessissa välit olivat vapaata tekstiä ("242-399", "9001-1000"), ja
 * analyysissä löytyi päällekkäisyyksiä, käänteisiä välejä, aukkoja ja
 * osakemääriä, jotka eivät vastanneet välejä. Tarkistus tuottaa ihmiselle
 * luettavat havainnot, joiden perusteella isännöitsijä korjaa tiedot
 * yhtiöjärjestyksestä ennen HTJ-vertailua.
 */

export interface ShareRange {
  first: number;
  last: number;
}

export interface ParsedRanges {
  ranges: ShareRange[];
  errors: string[];
}

export function parseShareRanges(text: string): ParsedRanges {
  const ranges: ShareRange[] = [];
  const errors: string[] = [];
  const parts = text.split(/[,;\n]/).map((p) => p.replace(/\s/g, "")).filter(Boolean);
  for (const part of parts) {
    const m = /^(\d+)(?:[-–](\d+))?$/.exec(part);
    if (!m) {
      errors.push(`Väliä "${part}" ei voi tulkita. Käytä muotoa 1-143.`);
      continue;
    }
    const first = Number(m[1]);
    const last = m[2] ? Number(m[2]) : first;
    if (first < 1) errors.push(`Osakenumero ei voi olla ${first}.`);
    else if (last < first) errors.push(`Väli ${first}-${last} on väärinpäin.`);
    else ranges.push({ first, last });
  }
  return { ranges, errors };
}

export function countShares(ranges: ShareRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.last - r.first + 1), 0);
}

export function formatRanges(ranges: ShareRange[]): string {
  return [...ranges]
    .sort((a, b) => a.first - b.first)
    .map((r) => (r.first === r.last ? String(r.first) : `${r.first}–${r.last}`))
    .join(", ");
}

export interface UnitRanges {
  unitLabel: string;
  ranges: ShareRange[];
}

export type CoverageIssue =
  | { kind: "overlap"; message: string; units: string[] }
  | { kind: "gap"; message: string; first: number; last: number }
  | { kind: "missing"; message: string; units: string[] }
  | { kind: "total"; message: string };

/**
 * Tarkistaa yhtiön kaikki osakeryhmät yhdessä: päällekkäisyydet, aukot,
 * puuttuvat välit ja täsmääkö viimeinen osakenumero yhtiön osakemäärään.
 */
export function checkCoverage(units: UnitRanges[], totalShares: number | null): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  const missing = units.filter((u) => u.ranges.length === 0).map((u) => u.unitLabel);
  if (missing.length > 0) {
    issues.push({ kind: "missing", message: `Osakenumerot puuttuvat: ${missing.join(", ")}`, units: missing });
  }

  const all = units
    .flatMap((u) => u.ranges.map((r) => ({ ...r, unit: u.unitLabel })))
    .sort((a, b) => a.first - b.first || a.last - b.last);

  let expectedNext = 1;
  let prev: (typeof all)[number] | null = null;
  for (const r of all) {
    if (prev && r.first <= prev.last) {
      issues.push({
        kind: "overlap",
        message: `Osakkeet ${r.first}–${Math.min(r.last, prev.last)} kuuluvat sekä huoneistolle ${prev.unit} että ${r.unit}`,
        units: [prev.unit, r.unit],
      });
    } else if (r.first > expectedNext) {
      issues.push({ kind: "gap", message: `Osakkeet ${expectedNext}–${r.first - 1} eivät kuulu millekään huoneistolle`, first: expectedNext, last: r.first - 1 });
    }
    if (!prev || r.last > prev.last) prev = r;
    expectedNext = Math.max(expectedNext, r.last + 1);
  }

  const lastShare = expectedNext - 1;
  if (totalShares && all.length > 0 && lastShare !== totalShares) {
    issues.push({
      kind: "total",
      message:
        lastShare < totalShares
          ? `Viimeinen osakenumero on ${lastShare}, mutta yhtiössä on ${totalShares} osaketta`
          : `Osakenumeroita on ${lastShare} asti, mutta yhtiössä on vain ${totalShares} osaketta`,
    });
  }
  return issues;
}
