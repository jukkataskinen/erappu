/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE } from "./art";

const PLANKS = [355, 380, 405];
const PICKETS = Array.from({ length: 12 }, (_, i) => 650 + i * 30);

/** Huoneistopiha: talon seinä ja syöksytorvi, terassi, kulkuväylä, pihavalaisin, istutukset, varasto ja aita. */
export function YardArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="260" fill={ART.sky} stroke="none" />
      <rect x="0" y="260" width="1000" height="380" fill={ART.green} stroke="none" />

      {/* Talon seinä, ikkuna ja ovi */}
      <rect x="0" y="0" width="280" height="330" fill={ART.wall} />
      <rect x="50" y="90" width="120" height="120" fill={ART.glass} />
      <rect x="190" y="180" width="70" height="150" fill={ART.fill} />

      {/* Syöksytorvi ja rännikaivo */}
      <rect x="282" y="0" width="20" height="330" fill={ART.metal} />
      <ellipse cx="300" cy="342" rx="24" ry="9" fill={ART.metal} />

      {/* Terassi */}
      <rect x="40" y="330" width="520" height="100" fill={ART.wood} />
      {PLANKS.map((y) => (
        <line key={y} x1="40" y1={y} x2="560" y2={y} stroke={ART.woodLine} strokeWidth="2" />
      ))}

      {/* Kulkuväylä */}
      <path d="M60 640 L180 640 L420 430 L340 430 Z" fill={ART.floor} />

      {/* Pihavalaisin */}
      <line x1="600" y1="180" x2="600" y2="430" strokeWidth="7" />
      <rect x="578" y="146" width="44" height="36" rx="6" fill={ART.fill} />

      {/* Ulkovarasto */}
      <rect x="700" y="140" width="200" height="150" fill={ART.wood} />
      <path d="M688 142 L800 88 L912 142 Z" fill={ART.metal} />
      <rect x="770" y="190" width="60" height="100" fill={ART.fill} />

      {/* Istutukset */}
      <circle cx="650" cy="340" r="38" fill={ART.bush} stroke={ART.greenLine} />
      <circle cx="712" cy="352" r="28" fill={ART.bush} stroke={ART.greenLine} />

      {/* Aita */}
      <line x1="640" y1="462" x2="990" y2="462" strokeWidth="5" />
      <line x1="640" y1="515" x2="990" y2="515" strokeWidth="5" />
      {PICKETS.map((x) => (
        <rect key={x} x={x - 8} y="435" width="16" height="105" rx="3" fill={ART.fill} />
      ))}
    </g>
  );
}
