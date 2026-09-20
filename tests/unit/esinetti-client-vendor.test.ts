import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER, MANIFEST, sha256, toVendorSource, VENDOR_DIR } from "../../scripts/sync-esinetti-client.mts";

/**
 * eSinetin client on yksi lähde (esinetti/clients/typescript/src), josta se
 * kopioidaan tänne komennolla `npm run esinetti:sync-client`. Nämä testit
 * pitävät kopion rehellisenä:
 *
 *  1. Kopiota ei ole muokattu paikallisesti (tiivisteet manifestissa).
 *  2. Kopio vastaa lähdettä, jos lähde on koneella. Jos ei ole (CI, toinen
 *     kone), tarkistus ohitetaan — se ei ole syy kaataa käännöstä.
 */

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { source: string; files: Record<string, string> };
const sourceDir = path.resolve(process.env.ESINETTI_CLIENT_SRC?.trim() || "../esinetti/clients/typescript/src");

describe("yhteinen eSinetti-client", () => {
  it("kopiota ei ole muokattu käsin", () => {
    const names = readdirSync(VENDOR_DIR).filter((n) => n.endsWith(".ts"));
    expect(names.sort()).toEqual(Object.keys(manifest.files).sort());
    for (const name of names) {
      const source = readFileSync(path.join(VENDOR_DIR, name), "utf8");
      expect(source.startsWith(HEADER.split("\n")[0]), `${name}: puuttuu "älä muokkaa" -merkintä`).toBe(true);
      expect(sha256(source), `${name} on muuttunut: aja npm run esinetti:sync-client`).toBe(manifest.files[name]);
    }
  });

  it("kopio vastaa lähdettä, jos lähde on koneella", () => {
    if (!existsSync(sourceDir)) {
      expect(manifest.source).toBe("esinetti/clients/typescript/src");
      return;
    }
    const names = readdirSync(sourceDir).filter((n) => n.endsWith(".ts") && n !== "index.ts");
    expect(names.sort(), "lähteessä on eri tiedostot kuin kopiossa").toEqual(Object.keys(manifest.files).sort());
    for (const name of names) {
      const expected = sha256(toVendorSource(readFileSync(path.join(sourceDir, name), "utf8")));
      expect(expected, `${name} on jäljessä: aja npm run esinetti:sync-client`).toBe(manifest.files[name]);
    }
  });

  it("sovelluskohtainen koodi ei ole kopiossa", () => {
    for (const name of Object.keys(manifest.files)) {
      const source = readFileSync(path.join(VENDOR_DIR, name), "utf8");
      expect(source, `${name} sisältää eRapun oman viitemuodon`).not.toContain("erappu:");
    }
  });
});
