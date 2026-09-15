import { describe, expect, it } from "vitest";
import { databaseUrl, dbDriver, migrationDatabaseUrl, stripSslMode, supabaseHeaders, supabaseSecretKey } from "@/lib/config/deploy-env";

describe("julkaisuympäristön muuttujat", () => {
  it("ilman kantaosoitetta käytetään PGlitea", () => {
    expect(dbDriver({})).toBe("pglite");
    expect(dbDriver({ DB_DRIVER: "pglite", POSTGRES_URL: "postgres://x" })).toBe("pglite");
  });

  it("Vercelin Supabase-integraation nimet kelpaavat, omat nimet voittavat", () => {
    const env = { POSTGRES_URL: "postgres://pool", POSTGRES_URL_NON_POOLING: "postgres://direct", SUPABASE_SECRET_KEY: "sb_secret_x" };
    expect(dbDriver(env)).toBe("postgres");
    expect(databaseUrl(env)).toBe("postgres://pool");
    expect(migrationDatabaseUrl(env)).toBe("postgres://direct");
    expect(supabaseSecretKey(env)).toBe("sb_secret_x");
    expect(databaseUrl({ ...env, DATABASE_URL: "postgres://oma" })).toBe("postgres://oma");
  });

  it("uusi salainen avain vain apikey-otsakkeeseen, vanha JWT myös Beareriksi", () => {
    expect(supabaseHeaders("sb_secret_x")).toEqual({ apikey: "sb_secret_x" });
    expect(supabaseHeaders("eyJ.a.b")).toEqual({ apikey: "eyJ.a.b", Authorization: "Bearer eyJ.a.b" });
  });

  it("poistaa sslmode-parametrin", () => {
    expect(stripSslMode("postgres://u:p@h:6543/postgres?sslmode=require&x=1")).toBe("postgres://u:p@h:6543/postgres?x=1");
  });
});
