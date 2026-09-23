import type { MetadataRoute } from "next";

/** Markkinointisivut indeksoidaan; sovelluksen reitit ovat lisäksi noindex juurilayoutissa. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/ominaisuudet", "/hinnat", "/ukk", "/yhteystiedot"], disallow: ["/"] }],
    sitemap: "https://www.erappu.fi/sitemap.xml",
  };
}
