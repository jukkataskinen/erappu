/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE } from "./art";

const SLATS = Array.from({ length: 8 }, (_, i) => 108 + i * 13);

function Sash({ x }: { x: number }) {
  return (
    <>
      <rect x={x} y="90" width="355" height="420" fill={ART.fill} />
      <rect x={x + 20} y="110" width="315" height="380" fill={ART.glass} />
      {/* Ulkopuite näkyy lasin läpi */}
      <rect x={x + 34} y="124" width="287" height="352" stroke={ART.lineSoft} strokeWidth="6" />
      {/* Tiiviste puitteen ja karmin välissä */}
      <rect x={x + 6} y="96" width="343" height="408" stroke={ART.line} strokeWidth="2" strokeDasharray="8 7" />
      {SLATS.map((y) => (
        <line key={y} x1={x + 22} y1={y} x2={x + 333} y2={y} stroke={ART.line} strokeWidth="2" />
      ))}
      <rect x={x + 20} y="100" width="315" height="8" fill={ART.metal} stroke="none" />
    </>
  );
}

/** Ikkuna sisältä: karmi, kaksi sisäpuitetta, ulkopuite lasin takana, kaihtimet, helat ja ikkunalauta. */
export function WindowsArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="640" fill={ART.wall} stroke="none" />
      <rect x="110" y="70" width="780" height="460" fill={ART.metal} strokeWidth="4" />
      <Sash x={130} />
      <Sash x={515} />
      <rect x="485" y="90" width="30" height="420" fill={ART.metal} />

      {/* Helat: saranat ja kääntökahva */}
      <rect x="124" y="150" width="12" height="36" rx="3" fill={ART.line} stroke="none" />
      <rect x="124" y="414" width="12" height="36" rx="3" fill={ART.line} stroke="none" />
      <rect x="522" y="270" width="16" height="60" rx="5" fill={ART.fill} />

      {/* Ikkunalauta */}
      <rect x="90" y="530" width="820" height="30" rx="4" fill={ART.fill} />
    </g>
  );
}
