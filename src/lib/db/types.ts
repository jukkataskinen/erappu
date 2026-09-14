/**
 * Tietokantakerroksen rajapinta.
 *
 * Sovellus ei käytä supabase-js:ää tietokantakutsuihin, vaan suoraa SQL:ää
 * tämän rajapinnan kautta. Syy: jokainen käyttäjän pyyntö ajetaan
 * transaktiossa roolilla `authenticated` ja käyttäjän JWT-väitteillä, jolloin
 * RLS on oikea suojaus. Portfolion muissa sovelluksissa kutsut tehtiin
 * service_role-avaimella ja eristys oli koodin varassa (DECISIONS.md).
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Database {
  /** Käyttäjän transaktio: rooli `authenticated`, RLS voimassa. */
  asUser<T>(sub: string, fn: (tx: Sql) => Promise<T>): Promise<T>;
  /** Palvelun transaktio: rooli `service_role`, ohittaa RLS:n. Vain palvelinkoodiin. */
  asService<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  /** Migraatioiden ajo ja ylläpito (pääkäyttäjä). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
