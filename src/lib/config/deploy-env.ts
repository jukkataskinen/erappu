/**
 * Ympäristömuuttujien nimet eri lähteistä. Vercelin Supabase-integraatio
 * kirjoittaa omat nimensä (`POSTGRES_URL`, `SUPABASE_SECRET_KEY`), käsin
 * asetetut käyttävät eRapun omia nimiä. Omat nimet voittavat.
 * Ei `server-only`-merkintää, koska myös skriptit käyttävät tätä.
 */

type Env = Record<string, string | undefined>;

/** Sovelluksen yhteys: poolattu osoite riittää, koska kaikki kyselyt ovat transaktioissa. */
export function databaseUrl(env: Env = process.env): string | undefined {
  return env.DATABASE_URL || env.POSTGRES_URL || undefined;
}

/** Migraatiot suoralla yhteydellä, jotta DDL ei kulje transaktiopoolerin kautta. */
export function migrationDatabaseUrl(env: Env = process.env): string | undefined {
  return env.DATABASE_URL_DIRECT || env.POSTGRES_URL_NON_POOLING || databaseUrl(env);
}

export function dbDriver(env: Env = process.env): "postgres" | "pglite" {
  if (env.DB_DRIVER === "postgres" || env.DB_DRIVER === "pglite") return env.DB_DRIVER;
  return databaseUrl(env) ? "postgres" : "pglite";
}

export function supabaseSecretKey(env: Env = process.env): string | undefined {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || undefined;
}

/**
 * Supabasen REST-otsakkeet. Uudet `sb_secret_`-avaimet eivät ole JWT:itä, joten
 * ne annetaan vain `apikey`-otsakkeessa; vanha service_role-JWT myös Bearerina.
 */
export function supabaseHeaders(key: string): Record<string, string> {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Integraation osoitteissa on usein `sslmode=require`, jonka pg tulkitsee
 * täydeksi varmennetarkistukseksi. Poistetaan, SSL asetetaan poolin optioilla.
 */
export function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}
