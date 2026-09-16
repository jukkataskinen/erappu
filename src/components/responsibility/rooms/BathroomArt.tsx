/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE, THIN } from "./art";

const TILE_ROWS = Array.from({ length: 8 }, (_, i) => 60 + i * 60);
const TILE_COLS = Array.from({ length: 16 }, (_, i) => 60 + i * 60);

/** Kylpyhuone edestä: suihku, pesuallas ja peilikaappi, wc, pesukone, lattiakaivo ja lattialämmitys. */
export function BathroomArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="520" fill={ART.wall} stroke="none" />
      <rect x="0" y="520" width="1000" height="120" fill={ART.floor} stroke="none" />
      {TILE_ROWS.map((y) => (
        <line key={`r${y}`} x1="0" y1={y} x2="1000" y2={y} {...THIN} strokeWidth="1" />
      ))}
      {TILE_COLS.map((x) => (
        <line key={`c${x}`} x1={x} y1="0" x2={x} y2="520" {...THIN} strokeWidth="1" />
      ))}
      <line x1="0" y1="520" x2="1000" y2="520" />

      {/* Vedeneristys lattian ja seinän liittymässä */}
      <line x1="10" y1="528" x2="990" y2="528" stroke={ART.line} strokeWidth="2" strokeDasharray="10 8" />
      <line x1="10" y1="528" x2="10" y2="430" stroke={ART.line} strokeWidth="2" strokeDasharray="10 8" />

      {/* Suihku */}
      <line x1="320" y1="90" x2="320" y2="520" stroke={ART.lineSoft} strokeWidth="5" />
      <rect x="115" y="320" width="70" height="26" rx="8" fill={ART.metal} />
      <line x1="150" y1="320" x2="150" y2="140" strokeWidth="5" />
      <path d="M150 140 H200" strokeWidth="5" />
      <ellipse cx="220" cy="150" rx="32" ry="10" fill={ART.metal} />

      {/* Lattiakaivo */}
      <ellipse cx="200" cy="565" rx="42" ry="15" fill={ART.metal} />
      <line x1="175" y1="565" x2="225" y2="565" strokeWidth="2" />

      {/* Peilikaappi ja valaisin */}
      <rect x="380" y="96" width="160" height="16" rx="6" fill={ART.fill} />
      <rect x="370" y="120" width="180" height="140" rx="6" fill={ART.glass} />
      <line x1="460" y1="120" x2="460" y2="260" />

      {/* Pesuallas ja hana */}
      <path d="M460 330 V308 H482" strokeWidth="6" />
      <path d="M380 330 H540 V345 Q540 380 505 380 H415 Q380 380 380 345 Z" fill={ART.fill} />
      <line x1="460" y1="380" x2="460" y2="450" {...THIN} stroke={ART.line} />

      {/* Ilmanvaihtoventtiili */}
      <circle cx="600" cy="70" r="26" fill={ART.fill} />
      <circle cx="600" cy="70" r="11" fill={ART.metal} />

      {/* WC-istuin */}
      <rect x="645" y="290" width="90" height="80" rx="8" fill={ART.fill} />
      <path d="M625 372 H755 V392 Q755 470 700 470 H680 Q625 470 625 392 Z" fill={ART.fill} />
      <rect x="665" y="470" width="50" height="50" fill={ART.fill} />

      {/* Pesukoneen hana ja letku */}
      <circle cx="800" cy="300" r="12" fill={ART.metal} />
      <path d="M800 312 Q800 350 840 352" {...THIN} stroke={ART.line} />

      {/* Pyykinpesukone */}
      <rect x="820" y="340" width="140" height="180" rx="8" fill={ART.fill} />
      <line x1="820" y1="368" x2="960" y2="368" />
      <circle cx="890" cy="445" r="44" fill={ART.glass} />

      {/* Lattialämmitys */}
      <path d="M560 585 q25 -18 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" stroke={ART.lineSoft} strokeWidth="4" />
    </g>
  );
}
