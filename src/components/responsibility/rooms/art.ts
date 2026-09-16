/**
 * Huonekuvien sävyt. Kuvat piirretään harmaansinisillä ja vaaleilla sävyillä,
 * koska korallinpunainen (yhtiö) ja sininen (osakas) on varattu pisteille:
 * jos kuvassa olisi samoja värejä, piste ei erottuisi eikä väri kertoisi vastuusta.
 * Pohja eRapun paletista (`globals.css`, `src/documents/theme.ts`).
 */
export const ART = {
  wall: "#f3f6fa",
  floor: "#e4eaf2",
  line: "#5a6b84",
  lineSoft: "#b7c3d4",
  fill: "#ffffff",
  fillSoft: "#eef3fa",
  metal: "#d5dde8",
  glass: "#e3edf8",
  wood: "#f1e6d2",
  woodLine: "#c9b28c",
  green: "#dcefe4",
  greenLine: "#8fbfa3",
  bush: "#bfe0cc",
  sky: "#f5f9fe",
} as const;

/** Kaikkien kuvien yhteinen viivatyyli. */
export const STROKE = {
  stroke: ART.line,
  strokeWidth: 3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

export const THIN = { stroke: ART.lineSoft, strokeWidth: 2 };
