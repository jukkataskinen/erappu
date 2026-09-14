/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Asiakirjojen taustamuoto. Pohja Reilusopparista.
 *
 * Isännöinnin asiakirjoissa ei ole kuvitusta (vinjettiä, lehtioksaa): ne
 * arkistoidaan ja tulostetaan, ja pöytäkirjan on näytettävä pöytäkirjalta.
 * Jäljelle jää yksi haalea muoto oikeassa ylänurkassa.
 *
 * `fixed` on pakollinen: ilman sitä absoluuttinen muoto osallistuu
 * sivutukseen ja voi tuottaa tyhjiä sivuja (Reilusopparin havainto).
 */

import { Path, Svg, View } from "@react-pdf/renderer";
import { spacing } from "./theme";

export function PageDecoration() {
  return (
    <View style={{ position: "absolute", top: -spacing.page, right: -spacing.page }} fixed>
      <Svg width={160} height={160} viewBox="0 0 215 215">
        <Path d="M215 -10 L215 185 C168 205 104 190 79 148 C53 104 87 44 149 28 C171 22 196 12 215 -10 Z" fill="#f1f6fd" />
      </Svg>
    </View>
  );
}
