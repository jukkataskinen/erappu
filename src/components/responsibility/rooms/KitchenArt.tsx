/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ART, STROKE, THIN } from "./art";

/** Keittiö edestä: yläkaapit, liesikupu, työtaso, allas leikattuna, tiskikone, liesi, jääkaappi ja putkikotelo. */
export function KitchenArt() {
  return (
    <g {...STROKE}>
      <rect x="0" y="0" width="1000" height="520" fill={ART.wall} stroke="none" />
      <rect x="0" y="520" width="1000" height="120" fill={ART.floor} stroke="none" />
      <line x1="0" y1="520" x2="1000" y2="520" />

      {/* Putkikotelo ja runkoputki */}
      <rect x="920" y="0" width="70" height="520" fill={ART.fillSoft} />
      <line x1="955" y1="12" x2="955" y2="508" stroke={ART.lineSoft} strokeWidth="12" />

      {/* Yläkaapit */}
      <rect x="60" y="100" width="360" height="150" rx="6" fill={ART.fill} />
      <line x1="240" y1="100" x2="240" y2="250" />
      <line x1="222" y1="210" x2="222" y2="236" />
      <line x1="258" y1="210" x2="258" y2="236" />
      <rect x="650" y="100" width="230" height="150" rx="6" fill={ART.fill} />
      <line x1="765" y1="100" x2="765" y2="250" />
      <line x1="748" y1="210" x2="748" y2="236" />
      <line x1="782" y1="210" x2="782" y2="236" />

      {/* Ilmanvaihtoventtiili */}
      <circle cx="765" cy="60" r="26" fill={ART.fill} />
      <circle cx="765" cy="60" r="11" fill={ART.metal} />

      {/* Liesikupu ja kanava */}
      <rect x="510" y="20" width="40" height="120" fill={ART.metal} />
      <path d="M465 140 H595 L620 220 H440 Z" fill={ART.metal} />

      {/* Pistorasiat */}
      <rect x="337" y="307" width="26" height="26" rx="5" fill={ART.fill} />
      <rect x="677" y="307" width="26" height="26" rx="5" fill={ART.fill} />
      <circle cx="345" cy="320" r="2" fill={ART.line} />
      <circle cx="355" cy="320" r="2" fill={ART.line} />
      <circle cx="685" cy="320" r="2" fill={ART.line} />
      <circle cx="695" cy="320" r="2" fill={ART.line} />

      {/* Hana */}
      <path d="M250 375 V300 Q250 278 226 282 L206 292" strokeWidth="6" stroke={ART.line} />

      {/* Työtaso ja alakaapit */}
      <rect x="50" y="375" width="700" height="25" fill={ART.wood} />
      <rect x="50" y="400" width="290" height="120" fill={ART.fillSoft} />
      <line x1="110" y1="400" x2="110" y2="520" />
      <rect x="640" y="400" width="110" height="120" fill={ART.fill} />
      <line x1="660" y1="420" x2="660" y2="450" />

      {/* Allas leikattuna, sulkuventtiili ja viemäri hajulukkoineen */}
      <path d="M140 400 V440 Q140 455 155 455 H265 Q280 455 280 440 V400" fill={ART.metal} />
      <path d="M210 455 V478 Q210 505 236 505 Q262 505 262 478 V470 H330" {...THIN} stroke={ART.line} />
      <line x1="310" y1="400" x2="310" y2="470" {...THIN} stroke={ART.line} />
      <circle cx="310" cy="432" r="9" fill={ART.fill} />
      <line x1="300" y1="432" x2="320" y2="432" strokeWidth="2" />

      {/* Tiskikone */}
      <rect x="350" y="400" width="130" height="120" fill={ART.fill} />
      <line x1="350" y1="420" x2="480" y2="420" />
      <line x1="385" y1="435" x2="445" y2="435" />

      {/* Liesi ja keittotaso */}
      <ellipse cx="525" cy="387" rx="20" ry="5" fill={ART.line} stroke="none" />
      <ellipse cx="595" cy="387" rx="20" ry="5" fill={ART.line} stroke="none" />
      <rect x="490" y="400" width="140" height="120" fill={ART.fill} />
      <line x1="490" y1="422" x2="630" y2="422" />
      <rect x="510" y="440" width="100" height="62" rx="4" fill={ART.glass} />
      <circle cx="515" cy="411" r="4" fill={ART.line} stroke="none" />
      <circle cx="540" cy="411" r="4" fill={ART.line} stroke="none" />

      {/* Jääkaappi */}
      <rect x="760" y="250" width="140" height="270" rx="6" fill={ART.fill} />
      <line x1="760" y1="360" x2="900" y2="360" />
      <line x1="780" y1="300" x2="780" y2="340" />
      <line x1="780" y1="380" x2="780" y2="430" />
    </g>
  );
}
