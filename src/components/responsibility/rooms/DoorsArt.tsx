/** @jsxRuntime automatic */
/** @jsxImportSource react */

/**
 * Ovet valokuvana (Jukka 23.9.2026): vasemmalla huoneiston ulko-ovi karmeineen
 * ja lukkoineen, oikealla huoneiston sisäovi.
 *
 * Kuva on 1536 × 1024 px ja täyttää viewBoxin 1000 × 640 (leikkaa ~13 yksikköä
 * ylhäältä ja alhaalta). Kuvapikseli → viewBox: x · 0,651, y · 0,651 − 13.
 * Pisteiden paikat ovat `content.ts`:ssä.
 */
export function DoorsArt() {
  return <image href="/vastuunjako/ovet.webp" x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" />;
}
