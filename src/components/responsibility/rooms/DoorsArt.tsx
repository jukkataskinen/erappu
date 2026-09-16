/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE } from "./art";

/** Eteinen: huoneiston ulko-ovi karmeineen ja varusteineen sekä sisäovi. */
export function DoorsArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="520" fill={ART.wall} stroke="none" />
      <rect x="0" y="520" width="1000" height="120" fill={ART.floor} stroke="none" />
      <line x1="0" y1="520" x2="1000" y2="520" />

      {/* Ulko-oven karmi, tiivisteet ja ovi */}
      <rect x="100" y="70" width="340" height="450" fill={ART.metal} />
      <rect x="120" y="90" width="300" height="430" fill={ART.fill} />
      <path d="M126 520 V96 H414 V520" stroke={ART.line} strokeWidth="2" strokeDasharray="8 7" />

      {/* Ovensulkija */}
      <rect x="290" y="96" width="70" height="20" rx="4" fill={ART.metal} />
      <line x1="360" y1="106" x2="432" y2="80" strokeWidth="5" />

      {/* Ovisilmä */}
      <circle cx="270" cy="175" r="10" fill={ART.metal} />

      {/* Postiluukku */}
      <rect x="200" y="360" width="140" height="26" rx="4" fill={ART.metal} />

      {/* Lukko ja kahva */}
      <rect x="385" y="318" width="18" height="26" rx="4" fill={ART.metal} />
      <line x1="394" y1="331" x2="350" y2="331" strokeWidth="6" />
      <circle cx="394" cy="372" r="8" fill={ART.metal} />

      {/* Sisäovi */}
      <rect x="600" y="120" width="300" height="400" fill={ART.metal} />
      <rect x="615" y="135" width="270" height="385" fill={ART.wood} />
      <rect x="650" y="170" width="200" height="130" rx="4" stroke={ART.woodLine} />
      <rect x="650" y="340" width="200" height="140" rx="4" stroke={ART.woodLine} />
      <line x1="860" y1="330" x2="830" y2="330" strokeWidth="6" />
    </g>
  );
}
