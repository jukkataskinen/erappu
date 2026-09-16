/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE } from "./art";

const RODS = Array.from({ length: 18 }, (_, i) => 240 + i * 40);

/** Parveke: rakennuksen seinä ja parvekeovi, laatta, kaide, lasitus, valaisin ja lumikinos. */
export function BalconyArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="640" fill={ART.sky} stroke="none" />

      {/* Rakennuksen seinä ja parvekeovi */}
      <rect x="0" y="0" width="160" height="640" fill={ART.wall} />
      <rect x="40" y="130" width="110" height="370" fill={ART.fill} />
      <rect x="58" y="150" width="74" height="220" fill={ART.glass} />

      {/* Valaisin ja pistorasia seinässä */}
      <rect x="160" y="150" width="40" height="40" rx="8" fill={ART.fill} />
      <rect x="164" y="250" width="26" height="26" rx="5" fill={ART.fill} />

      {/* Lasitus */}
      <rect x="190" y="70" width="780" height="14" rx="4" fill={ART.metal} />
      <rect x="200" y="84" width="760" height="246" fill={ART.glass} fillOpacity="0.7" />
      <line x1="390" y1="84" x2="390" y2="330" stroke={ART.lineSoft} />
      <line x1="580" y1="84" x2="580" y2="330" stroke={ART.lineSoft} />
      <line x1="770" y1="84" x2="770" y2="330" stroke={ART.lineSoft} />

      {/* Kaide */}
      <rect x="200" y="326" width="760" height="12" rx="4" fill={ART.metal} />
      {RODS.map((x) => (
        <line key={x} x1={x} y1="338" x2={x} y2="500" stroke={ART.lineSoft} strokeWidth="4" />
      ))}
      <line x1="200" y1="338" x2="200" y2="500" />
      <line x1="960" y1="338" x2="960" y2="500" />

      {/* Laatta */}
      <rect x="160" y="500" width="820" height="45" fill={ART.metal} />
      <line x1="160" y1="506" x2="980" y2="506" stroke={ART.fill} strokeWidth="3" />

      {/* Lumikinos */}
      <path d="M835 500 Q860 462 895 474 Q930 452 965 500 Z" fill={ART.fill} stroke={ART.lineSoft} />
    </g>
  );
}
