/**
 * Asiakirjojen fontit.
 *
 * Plus Jakarta Sans, sama kuin sovelluksessa ja sivustolla. React-PDF ei lue
 * woff2-muotoa eikä osaa muuttuvia fontteja, joten leikkaukset ovat erillisiä
 * staattisia TTF-tiedostoja (`fonts/`, muunnettu `@fontsource`-paketista).
 */

import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { FONT_FAMILY, weight } from "./theme";

const WEIGHTS = [weight.regular, weight.medium, weight.bold] as const;

/**
 * Kursiivi vain yhdessä leikkauksessa (huomautukset ja luonnosmerkinnät).
 * Rekisteröinti ei maksa mitään asiakirjoille, jotka eivät käytä sitä:
 * PDF:ään upotetaan vain ne merkit, joita oikeasti piirretään.
 */
const ITALIC_WEIGHT = weight.medium;

let registered = false;
let loaded: Promise<void> | null = null;

function fontPath(fontWeight: number): string {
  return path.join(process.cwd(), "src/documents/fonts", `plus-jakarta-sans-${fontWeight}.ttf`);
}

function registerDocumentFonts(): void {
  if (registered) return;

  /**
   * Tavutus pois päältä.
   *
   * React-PDF tavuttaa oletuksena englannin säännöillä, ja suomenkielisessä
   * tekstissä tulos on väärä: "vi-imeistään", "sovi-tussa", "ilmoit-taa".
   * Väärin tavutettu sana on asiakirjassa pahempi kuin hieman epätasainen
   * oikea reuna — ja tämä on asiakirja, jonka kaksi ihmistä lukee ja
   * allekirjoittaa.
   *
   * Suomen tavutussanakirjaa ei ole saatavilla, joten oikea valinta on olla
   * tavuttamatta lainkaan.
   */
  Font.registerHyphenationCallback((word) => [word]);

  Font.register({
    family: FONT_FAMILY,
    fonts: [
      ...WEIGHTS.map((fontWeight) => ({ src: fontPath(fontWeight), fontWeight })),
      {
        src: path.join(process.cwd(), "src/documents/fonts", "plus-jakarta-sans-500-italic.ttf"),
        fontWeight: ITALIC_WEIGHT,
        fontStyle: "italic" as const,
      },
    ],
  });

  registered = true;
}

/**
 * Varmistaa, että fontit ovat luettuina ennen renderöintiä.
 *
 * ===========================================================================
 * TÄMÄ EI OLE OPTIMOINTI VAAN DETERMINISMIN EHTO
 *
 * React-PDF lataa fontin levyltä vasta tarvittaessa. Jos renderöinti alkaa
 * ennen kuin lataus on valmis, se käyttää korvaavaa fonttia — ja tuottaa eri
 * tavut kuin sama asiakirja hetkeä myöhemmin. Testeissä tämä näkyi
 * satunnaisena epäonnistumisena noin joka kolmannessa täydessä ajossa;
 * tuotannossa se olisi tarkoittanut, että saman sopimuksen tiiviste riippuu
 * siitä, monesko renderöinti prosessin käynnistyksen jälkeen se on.
 *
 * Asiakirjan SHA-256 on osa sen todistusvoimaa, joten tämä ei ole pieni asia.
 * ===========================================================================
 */
export async function ensureDocumentFonts(): Promise<void> {
  registerDocumentFonts();

  if (!loaded) {
    loaded = Promise.all([
      ...WEIGHTS.map((fontWeight) => Font.load({ fontFamily: FONT_FAMILY, fontWeight })),
      Font.load({ fontFamily: FONT_FAMILY, fontWeight: ITALIC_WEIGHT, fontStyle: "italic" }),
    ]).then(() => undefined);
  }

  await loaded;
}
