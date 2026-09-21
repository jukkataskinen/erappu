/** @jsxRuntime automatic */
/** @jsxImportSource react */

/**
 * Keittiö edestä valokuvana (Jukka 21.9.2026): yläkaapit, liesikupu,
 * ilmanvaihtoventtiili, avoin allaskaappi (vesijohdot, sulut ja hajulukko),
 * astianpesukone, uuni ja jääkaappi.
 *
 * Kuva on 1560 × 1008 px ja täyttää viewBoxin 1000 × 640 (leikkaa ~3 yksikköä
 * ylhäältä ja alhaalta). Kuvapikseli → viewBox: x · 0,641, y · 0,641 − 3.
 * Pisteiden paikat ovat `content.ts`:ssä.
 */
export function KitchenArt() {
  return <image href="/vastuunjako/keittio.webp" x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" />;
}
