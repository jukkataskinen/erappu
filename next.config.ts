import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Kamera sallitaan huoltopyyntöjen kuvia varten. Paikannusta ei tarvita.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // PGlite on WASM-paketti, jota ei saa niputtaa palvelinkoodiin.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  experimental: {
    // Middleware katkaisee oletuksena yli 10 Mt:n pyynnöt; dokumentit ovat enintään 20 Mt (MAX_UPLOAD_BYTES) + lomakekentät.
    middlewareClientMaxBodySize: "21mb",
  },
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/**", "./src/documents/fonts/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
