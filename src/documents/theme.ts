/**
 * Asiakirjojen ulkoasun perusarvot. Pohja Reilusopparista, brändi eRapun.
 *
 * Isännöinnin asiakirjat (kokouskutsu, pöytäkirja, isännöitsijäntodistus)
 * luetaan usein tulostettuina ja arkistoidaan vuosikymmeniksi. Siksi ulkoasu
 * on rauhallinen: sininen toimintoväri, ohuet viivat, ei kuvitusta.
 * Korallia käytetään vain merkin ovessa ja luonnosmerkinnässä, jolloin se
 * luetaan varoitukseksi eikä koristeeksi.
 */

/** A4 pisteinä. Tarvitaan, kun jokin sijoitetaan sivun reunaan absoluuttisesti. */
export const A4_WIDTH = 595;
export const A4_HEIGHT = 842;

/** Sama paletti kuin sovelluksessa (`globals.css`), pehmennettynä paperille. */
export const colors = {
  ink: "#1b2a41",
  inkSoft: "#5a6b84",
  inkFaint: "#8a99b0",
  sky: "#3d8bff",
  skySoft: "#8fb9ff",
  coral: "#ff6f59",
  /** Paneelien tausta. Riittävän vaalea, että teksti pysyy luettavana tulostettuna. */
  panel: "#eef3fa",
  panelStrong: "#d8e6f9",
  line: "#dfe6f0",
  paper: "#ffffff",
} as const;

/** Pistekoot. A4:lla 10 pt leipäteksti on luettavaa myös tulostettuna. */
export const type = {
  title: 22,
  subtitle: 11.5,
  heading: 12,
  body: 10,
  small: 8.5,
  label: 7.5,
} as const;

export const spacing = {
  page: 42,
  block: 16,
  panel: 12,
  row: 5,
} as const;

export const radius = {
  panel: 8,
  pill: 6,
} as const;

/** Yksi fonttiperhe, kolme leikkausta. Ks. `fonts.ts`. */
export const FONT_FAMILY = "Jakarta";

export const weight = {
  regular: 400 as const,
  medium: 600 as const,
  bold: 700 as const,
};
