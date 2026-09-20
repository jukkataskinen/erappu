import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { EsinettiError, type EsinettiClient, type EsinettiCompanyInput } from "@/lib/esinetti";
import { EsinettiMockClient, resetMockEsinetti } from "@/lib/esinetti/mock";
import { ensureEsinettiCompany } from "@/lib/signing/company";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";

/**
 * Taloyhtiön vastine eSinetissä (0111): luodaan kerran, muistetaan, eikä
 * allekirjoitus kaadu siihen, jos luonti epäonnistuu.
 */

let db: Database;
let f: Fixture;

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
});
afterAll(async () => db.close());

/** Sama muoto kuin sovelluskoodin `ctx.run`. */
const runAs = (sub: string) => <T,>(fn: Parameters<typeof db.asUser<T>>[1]) => db.asUser(sub, fn);

describe("yhtiö eSinetissä", () => {
  it("luodaan ensimmäisellä kerralla ja muistetaan y-tunnuksella", async () => {
    resetMockEsinetti();
    const mock = new EsinettiMockClient();
    const calls: EsinettiCompanyInput[] = [];
    const client = {
      upsertCompany: (input: EsinettiCompanyInput) => {
        calls.push(input);
        return mock.upsertCompany(input);
      },
    } as unknown as EsinettiClient;

    const first = await ensureEsinettiCompany(runAs(f.managerA.sub), client, f.companyA);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ externalRef: `erappu:company:${f.companyA}` });
    expect(calls[0].businessId).toBeTruthy();

    const stored = await db.asUser(f.managerA.sub, (tx) =>
      one<{ esinetti_company_id: string | null }>(tx, "select esinetti_company_id from er_housing_companies where id = $1", [f.companyA]),
    );
    expect(stored.esinetti_company_id).toBe(first);

    // Toinen kerta lukee tallennetun tunnisteen eikä kutsu rajapintaa.
    const second = await ensureEsinettiCompany(runAs(f.managerA.sub), client, f.companyA);
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("epäonnistunut luonti ei kaada allekirjoitusta eikä tallenna mitään", async () => {
    const failing = {
      upsertCompany: async () => {
        throw new EsinettiError("service_unavailable", "eSinetti ei vastaa.");
      },
    } as unknown as EsinettiClient;

    const result = await ensureEsinettiCompany(runAs(f.managerB.sub), failing, f.companyB);
    expect(result).toBeUndefined();
    const stored = await db.asUser(f.managerB.sub, (tx) =>
      one<{ esinetti_company_id: string | null }>(tx, "select esinetti_company_id from er_housing_companies where id = $1", [f.companyB]),
    );
    expect(stored.esinetti_company_id).toBeNull();
  });

  it("tuntematon yhtiö palauttaa tyhjän", async () => {
    const client = new EsinettiMockClient();
    expect(await ensureEsinettiCompany(runAs(f.managerA.sub), client, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
