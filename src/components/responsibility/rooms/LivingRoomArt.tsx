/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE, THIN } from "./art";

const FINS = Array.from({ length: 12 }, (_, i) => 600 + i * 20);
const BOARDS = [560, 600];

/** Olohuone: seinä ja lattia, ikkuna ja patteri, sohva, rasiat, sähkökeskus ja poistoventtiili. */
export function LivingRoomArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="520" fill={ART.wall} stroke="none" />
      <rect x="0" y="520" width="1000" height="120" fill={ART.wood} stroke="none" />
      {BOARDS.map((y) => (
        <line key={y} x1="0" y1={y} x2="1000" y2={y} stroke={ART.woodLine} strokeWidth="1.5" />
      ))}
      <line x1="0" y1="520" x2="1000" y2="520" />

      {/* Poistoventtiili */}
      <circle cx="300" cy="60" r="26" fill={ART.fill} />
      <circle cx="300" cy="60" r="11" fill={ART.metal} />

      {/* Ikkuna */}
      <rect x="560" y="100" width="300" height="240" fill={ART.fill} />
      <rect x="578" y="118" width="264" height="204" fill={ART.glass} />
      <line x1="710" y1="118" x2="710" y2="322" />

      {/* Patteri ja termostaatti */}
      <rect x="580" y="380" width="260" height="70" rx="6" fill={ART.fill} />
      {FINS.map((x) => (
        <line key={x} x1={x} y1="392" x2={x} y2="438" {...THIN} />
      ))}
      <path d="M840 415 H852" />
      <circle cx="866" cy="415" r="14" fill={ART.metal} />

      {/* Sohva */}
      <rect x="80" y="380" width="350" height="70" rx="20" fill={ART.fillSoft} />
      <rect x="70" y="440" width="370" height="60" rx="14" fill={ART.fillSoft} />
      <line x1="95" y1="500" x2="95" y2="518" strokeWidth="6" />
      <line x1="415" y1="500" x2="415" y2="518" strokeWidth="6" />

      {/* Antenni- ja tietoliikennerasia */}
      <rect x="334" y="314" width="32" height="32" rx="5" fill={ART.fill} />
      <circle cx="350" cy="330" r="6" fill={ART.metal} />

      {/* Kaksoispistorasia */}
      <rect x="440" y="436" width="60" height="28" rx="5" fill={ART.fill} />
      <circle cx="456" cy="450" r="2.5" fill={ART.line} stroke="none" />
      <circle cx="484" cy="450" r="2.5" fill={ART.line} stroke="none" />

      {/* Huoneiston sähkökeskus */}
      <rect x="880" y="120" width="100" height="140" rx="6" fill={ART.fill} />
      <line x1="895" y1="160" x2="965" y2="160" {...THIN} />
      <line x1="895" y1="190" x2="965" y2="190" {...THIN} />
      <line x1="895" y1="220" x2="965" y2="220" {...THIN} />
    </g>
  );
}
