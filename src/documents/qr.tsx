/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * QR-koodi vektorina. Kopioitu Reilusopparista.
 *
 * ===========================================================================
 * MIKSI ITSE PIIRRETTY EIKÄ KUVANA
 *
 * Ulkoista QR-palvelua ei voi käyttää: renderöijä ei hae mitään verkosta,
 * eikä todistuksen tunnistetta lähetetä kolmannelle osapuolelle. Se olisi
 * jakolinkin luovuttamista ulkopuoliselle.
 *
 * Kuvaksi pakattu QR olisi mahdollinen, mutta moduuleista piirretty on
 * terävä missä tahansa koossa, pienempi tavuina ja deterministinen ilman
 * PNG-pakkaajan versioriippuvuutta.
 * ===========================================================================
 */

import QRCode from "qrcode";
import { Rect, Svg } from "@react-pdf/renderer";

export interface QrProps {
  value: string;
  /** Sivun mitta pisteinä. */
  size?: number;
  color?: string;
}

/**
 * Piirtää QR-koodin mustista moduuleista.
 *
 * Virheenkorjaustaso on `M`: se kestää noin 15 % vahingoittumista, mikä
 * riittää paperilta luettavalle koodille. Korkeampi taso kasvattaisi
 * moduulien määrää ja tekisi koodista tiheämmän samassa koossa.
 */
export function QrCode({ value, size = 84, color = "#1b2a41" }: QrProps) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const data = qr.modules.data;

  /**
   * Hiljainen alue neljä moduulia joka reunalla. Ilman sitä lukijaohjelma ei
   * löydä koodin rajoja paperilta — tämä on QR-standardin vaatimus eikä
   * ulkoasuvalinta.
   */
  const quiet = 4;
  const total = count + quiet * 2;
  const unit = size / total;

  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (data[row * count + column]) cells.push({ x: column, y: row });
    }
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={0} y={0} width={size} height={size} fill="#ffffff" />
      {cells.map((cell) => (
        <Rect
          key={`${cell.x}-${cell.y}`}
          x={(cell.x + quiet) * unit}
          y={(cell.y + quiet) * unit}
          // Puoli pistettä liikaa: vierekkäiset moduulit sulautuvat yhteen
          // eikä väliin jää valkoista viivaa, joka sekoittaisi lukijan.
          width={unit + 0.5}
          height={unit + 0.5}
          fill={color}
        />
      ))}
    </Svg>
  );
}
