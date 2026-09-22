/**
 * Kopioi eSinetin clientin tähän repoon (`src/lib/esinetti/vendor`).
 *
 * Client elää yhdessä paikassa, eSinetin repossa (`clients/typescript/src`),
 * koska rajapinta ja client muuttuvat yhdessä. Kopiota ei muokata käsin:
 * `tests/unit/esinetti-client-vendor.test.ts` kaatuu, jos kopio poikkeaa
 * lähteestä tai sitä on muokattu.
 *
 *   npm run esinetti:sync-client
 *   ESINETTI_CLIENT_SRC=../esinetti/clients/typescript/src npm run esinetti:sync-client
 *
 * Sovelluskohtainen koodi (esimerkiksi ulkoisen viitteen muoto) EI kuulu
 * tänne vaan `src/lib/esinetti`-kansion omiin tiedostoihin.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const VENDOR_DIR = "src/lib/esinetti/vendor";
export const MANIFEST = path.join(VENDOR_DIR, "MANIFEST.json");
const DEFAULT_SOURCE = "../esinetti/clients/typescript/src";

export const HEADER = [
  "// KONEELLISESTI KOPIOITU – älä muokkaa.",
  "// Lähde: esinetti/clients/typescript/src. Päivitä: npm run esinetti:sync-client",
  "",
].join("\n");

/**
 * Tiiviste rivinvaihdoista riippumatta: Windows-kone voi tallentaa kopion
 * CRLF-rivinvaihdoin, CI:n checkout on LF. Ilman normalisointia sama sisältö
 * näyttäisi muokatulta.
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** Bundleri ei tarvitse `.js`-päätteitä, ja ilman niitä tiedostot näyttävät muulta koodilta. */
export function toVendorSource(source: string): string {
  return HEADER + source.replace(/\r\n/g, "\n").replace(/from "\.\/([a-z-]+)\.js"/g, 'from "./$1"');
}

export async function syncClient(sourceDir: string): Promise<{ files: string[]; manifest: Record<string, string> }> {
  const names = (await readdir(sourceDir)).filter((n) => n.endsWith(".ts") && n !== "index.ts");
  if (names.length === 0) throw new Error(`Lähteessä ei ole tiedostoja: ${sourceDir}`);
  await mkdir(VENDOR_DIR, { recursive: true });
  const manifest: Record<string, string> = {};
  for (const name of names) {
    const vendored = toVendorSource(await readFile(path.join(sourceDir, name), "utf8"));
    await writeFile(path.join(VENDOR_DIR, name), vendored, "utf8");
    manifest[name] = sha256(vendored);
  }
  await writeFile(MANIFEST, JSON.stringify({ source: "esinetti/clients/typescript/src", files: manifest }, null, 2) + "\n", "utf8");
  return { files: names, manifest };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const sourceDir = path.resolve(process.env.ESINETTI_CLIENT_SRC?.trim() || DEFAULT_SOURCE);
  const { files } = await syncClient(sourceDir);
  console.log(`Kopioitu ${files.length} tiedostoa: ${files.join(", ")}\nLähde: ${sourceDir}`);
}
