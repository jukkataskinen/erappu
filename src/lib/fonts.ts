import localFont from "next/font/local";

/** Sama Plus Jakarta Sans kuin Reilusopparissa, itse hostattuna. */
export const sans = localFont({
  src: "../../public/fonts/sans-variable.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-sans-local",
  adjustFontFallback: "Arial",
});
