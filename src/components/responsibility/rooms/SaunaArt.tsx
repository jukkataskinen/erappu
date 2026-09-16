/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE } from "./art";

const PANELS = Array.from({ length: 24 }, (_, i) => 40 + i * 40);
const STONES = [140, 172, 204, 236, 268];

/** Huoneiston sauna: paneloitu seinä, lauteet, kiuas liitäntöineen, valaisin ja lattiakaivo. */
export function SaunaArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="520" fill={ART.wood} stroke="none" />
      {PANELS.map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="520" stroke={ART.woodLine} strokeWidth="1.5" />
      ))}
      <rect x="0" y="520" width="1000" height="120" fill={ART.floor} stroke="none" />
      <line x1="0" y1="520" x2="1000" y2="520" />
      <line x1="10" y1="528" x2="990" y2="528" stroke={ART.line} strokeWidth="2" strokeDasharray="10 8" />

      {/* Valaisin */}
      <path d="M840 60 H920 V84 Q880 116 840 84 Z" fill={ART.fill} />
      <line x1="852" y1="72" x2="908" y2="72" strokeWidth="2" />

      {/* Kiukaan ohjauskeskus ja syöttö */}
      <rect x="55" y="200" width="60" height="80" rx="6" fill={ART.fill} />
      <circle cx="85" cy="230" r="9" fill={ART.metal} />
      <path d="M85 280 V430 H120" strokeWidth="4" />

      {/* Kiuas */}
      <rect x="120" y="340" width="180" height="180" rx="6" fill={ART.metal} />
      <line x1="120" y1="380" x2="300" y2="380" />
      {STONES.map((x) => (
        <circle key={x} cx={x + 6} cy="326" r="15" fill={ART.fill} />
      ))}

      {/* Lauteet */}
      <rect x="420" y="290" width="540" height="30" rx="4" fill={ART.fill} />
      <rect x="420" y="400" width="540" height="26" rx="4" fill={ART.fill} />
      <line x1="460" y1="320" x2="460" y2="520" strokeWidth="6" stroke={ART.woodLine} />
      <line x1="920" y1="320" x2="920" y2="520" strokeWidth="6" stroke={ART.woodLine} />
      <line x1="690" y1="320" x2="690" y2="400" strokeWidth="6" stroke={ART.woodLine} />

      {/* Lattiakaivo */}
      <ellipse cx="480" cy="580" rx="42" ry="15" fill={ART.metal} />
      <line x1="455" y1="580" x2="505" y2="580" strokeWidth="2" />
    </g>
  );
}
