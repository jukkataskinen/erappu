import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Luo sovelluksen salaisuudet ja asetukset Vercel-projektiin ilman, että arvot
 * tulostuvat tai kulkevat leikepöydän kautta. Olemassa olevaa muuttujaa ei
 * ylikirjoiteta (kenttäsalausavaimen vaihto rikkoisi salatut arvot).
 *
 *   npx tsx scripts/deploy/set-vercel-secrets.mts
 *
 * Vaatii `vercel login` ja `vercel link`. Tuotanto ja esikatselu jakavat saman
 * Supabase-kannan, joten niillä on samat avaimet.
 */

const secret = () => randomBytes(32).toString("base64");

const shared: Record<string, string> = {
  SESSION_SECRET: secret(),
  LINK_TOKEN_SECRET: secret(),
  FIELD_ENCRYPTION_KEY: secret(),
  HETU_PEPPER: secret(),
  CRON_SECRET: randomBytes(32).toString("base64url"),
  STORAGE_DRIVER: "supabase",
  AUTH_MODE: "dev",
  HTJ_MODE: "mock",
  ESINETTI_MODE: "mock",
  EMAIL_MODE: "console",
};
const previewOnly: Record<string, string> = { ALLOW_PREVIEW_DEV_LOGIN: "1" };

const vercel = (args: string[], input?: string) =>
  spawnSync("npx", ["--yes", "vercel@latest", ...args], { input, encoding: "utf8", shell: true });

const listed = vercel(["env", "ls"]);
const existing = new Set([...(listed.stdout ?? "").matchAll(/^\s*([A-Z0-9_]+)\s+/gm)].map((m) => m[1]));

function add(name: string, value: string, target: "production" | "preview") {
  if (existing.has(name)) {
    console.log(`${name}: on jo olemassa, ei muutettu`);
    return;
  }
  const args = ["env", "add", name, target];
  if (target === "preview") args.push("");
  const res = vercel(args, value);
  console.log(`${name} (${target}): ${res.status === 0 ? "lisätty" : `VIRHE ${(res.stderr ?? "").split("\n").filter(Boolean).slice(-2).join(" ")}`}`);
}

for (const [name, value] of Object.entries(shared)) {
  add(name, value, "production");
  add(name, value, "preview");
}
for (const [name, value] of Object.entries(previewOnly)) add(name, value, "preview");
