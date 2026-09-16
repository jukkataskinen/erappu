import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Omat sivut saavat näyttää PDF:n kehyksessä (kokouksen asiakirjan esikatselu); muut sivustot eivät.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Kamera sallitaan huoltopyyntöjen kuvia varten. Paikannusta ei tarvita.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // PGlite on WASM-paketti, jota ei saa niputtaa palvelinkoodiin.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  experimental: {
    // Middleware katkaisee oletuksena yli 10 Mt:n pyynnöt; dokumentit ovat enintään 20 Mt (MAX_UPLOAD_BYTES) + lomakekentät.
    middlewareClientMaxBodySize: "21mb",
    serverActions: {
      // Palvelintoiminnon oletusraja on 1 Mt. Muutostyöilmoituksen liitteet
      // (suunnitelma-PDF, pohjapiirustus) tulevat palvelintoiminnolla, ja niiden
      // yhteiskoko rajataan sovelluksessa (MAX_NOTICE_ATTACHMENT_TOTAL).
      bodySizeLimit: "21mb",
    },
  },
  outputFileTracingIncludes: {
    // pdfkit lataa vakiofontit dynaamisella requirella, jota jäljitin ei näe
    // (Reilusopparissa PDF kaatui tuotannossa ilman näitä).
    "/**": [
      "./supabase/migrations/**",
      "./src/documents/fonts/**",
      "./node_modules/pdfkit/js/standard-fonts/**",
      "./node_modules/pdfkit/js/data/**",
      "./node_modules/@react-pdf/pdfkit/lib/**",
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
