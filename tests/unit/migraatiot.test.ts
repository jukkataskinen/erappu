import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migraatiotiedostojen järjestys. Grantit tarkistetaan kannasta
 * (tests/db/grantit.test.ts), koska osa migraatioista antaa ne silmukassa.
 */
const DIR = path.join(process.cwd(), "supabase/migrations");

describe("migraatiot", () => {
  it("migraatiot on numeroitu yksilöllisesti ja järjestyksessä", () => {
    const numerot = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4));
    expect(new Set(numerot).size).toBe(numerot.length);
    expect([...numerot].sort()).toEqual(numerot.sort());
  });
});
