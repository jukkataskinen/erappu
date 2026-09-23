/** @jsxRuntime automatic */
/** @jsxImportSource react */

/**
 * Kylpyhuone valokuvana (Jukka 23.9.2026): suihku, pesuallas, peilikaappi,
 * poistoilmaventtiili, wc-istuin, pyykinpesukone ja lattiakaivo. Kuvassa on
 * lisäksi kaksi piirrettyä merkintää, jotka eivät näy oikeassa
 * kylpyhuoneessa: sininen viiva lattian rajassa on vedeneristys ja lattian
 * aaltoviiva lattialämmitys. Molemmilla on oma pisteensä.
 *
 * Kuva on 1583 × 994 px ja täyttää viewBoxin 1000 × 640 (leikkaa ~10 yksikköä
 * sivuilta). Kuvapikseli → viewBox: x · 0,644 − 10, y · 0,644.
 * Pisteiden paikat ovat `content.ts`:ssä.
 */
export function BathroomArt() {
  return <image href="/vastuunjako/kylpyhuone.webp" x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" />;
}
