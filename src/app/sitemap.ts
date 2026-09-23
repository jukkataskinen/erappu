import type { MetadataRoute } from "next";

const BASE = "https://www.erappu.fi";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/hallitukselle", "/ominaisuudet", "/hinnat", "/ukk", "/yhteystiedot", "/tietosuoja"].map((path) => ({ url: `${BASE}${path}`, changeFrequency: "monthly", priority: path ? 0.7 : 1 }));
}
