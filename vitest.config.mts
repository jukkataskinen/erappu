import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // Jokainen testitiedosto käynnistää oman PGlite-kannan ja ajaa migraatiot.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // server-only heittää virheen Nextin ulkopuolella; testeissä se on tyhjä.
      "server-only": path.resolve(import.meta.dirname, "./tests/helpers/empty.ts"),
    },
  },
});
