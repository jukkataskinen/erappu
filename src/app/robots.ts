import type { MetadataRoute } from "next";

/** Markkinointisivut indeksoidaan; sovelluksen reitit ovat lisäksi noindex juurilayoutissa. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/hallitukselle", "/ominaisuudet", "/hinnat", "/ukk", "/yhteystiedot", "/tietosuoja"], disallow: ["/"] }],
    sitemap: "https://www.erappu.fi/sitemap.xml",
  };
}
