/** @jsxRuntime automatic */
/** @jsxImportSource react */

/**
 * Ikkunat valokuvana (Jukka 23.9.2026): vasemmalla ikkuna sisältä
 * sälekaihtimineen ja kääntökahvoineen, oikealla sama ikkuna ulkoa.
 *
 * Kuva on 1312 × 810 px ja täyttää viewBoxin 1000 × 640 (leikkaa ~18 yksikköä
 * sivuilta). Kuvapikseli → viewBox: x · 0,790 − 18, y · 0,790.
 * Pisteiden paikat ovat `content.ts`:ssä.
 */
export function WindowsArt() {
  return <image href="/vastuunjako/ikkunat.webp" x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" />;
}
