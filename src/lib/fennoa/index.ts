/**
 * Fennoa-rajapinta isännöintiyrityksen omaan myyntilaskutukseen (postikulut
 * taloyhtiöiltä, Jukka 26.9.2026). Adepta Tilat laskuttaa isännöinnin
 * Fennoassa. Tämä ei koske taloyhtiöiden kirjanpitoa, joka on Procountorissa
 * (CLAUDE.md 1).
 *
 * Tilat (FENNOA_MODE), kuten Mittarilukemassa:
 *   mock  oletus: mitään ei lähetetä, laskut "luodaan" muistiin
 *   test  Fennoan testiyritys tunnuksilla FENNOA_TEST_API_USER ja FENNOA_TEST_API_KEY
 * Tuotantoon vientiä ei ole kytketty, koska Fennoan tuotantoon luotuja
 * laskuja ei voi poistaa; se otetaan käyttöön erillisellä päätöksellä
 * (BLOCKERS 16). Siihen asti laskut tehdään Fennoaan käsin eRapun
 * erittelystä (CSV).
 *
 * Laskut viedään luonnoksina (sales_api/add), ja ne hyväksytään ja
 * lähetetään Fennoassa. Kentät: tietopankki.fennoa.com/api-sales-invoices.
 */

const API_URL = "https://app.fennoa.com/api/";

export type FennoaEnvironment = "mock" | "test";

export interface FennoaClient {
  environment: FennoaEnvironment;
  /** Luo laskuluonnoksen. Palauttaa Fennoan laskutunnuksen. */
  addInvoice(form: Record<string, string>): Promise<{ id: string }>;
}

export class FennoaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "FennoaError";
  }
}

export function isFennoaError(err: unknown): err is FennoaError {
  return err instanceof FennoaError;
}

let mockInvoices: Map<string, Record<string, string>> | null = null;

/** Jäljitelmä: luodut laskut muistissa (testit lukevat ne `mockFennoaInvoices()`:lla). */
export function mockFennoa(): FennoaClient {
  mockInvoices ??= new Map();
  const invoices = mockInvoices;
  return {
    environment: "mock",
    async addInvoice(form) {
      const id = `mock-${Date.now().toString(36)}-${invoices.size + 1}`;
      invoices.set(id, form);
      return { id };
    },
  };
}

export function mockFennoaInvoices(): Map<string, Record<string, string>> {
  mockInvoices ??= new Map();
  return mockInvoices;
}

function httpClient(user: string, key: string): FennoaClient {
  const auth = `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`;
  return {
    environment: "test",
    async addInvoice(form) {
      let res: Response;
      try {
        res = await fetch(API_URL + "sales_api/add", {
          method: "POST",
          headers: { Accept: "application/json", Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(form),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new FennoaError("Fennoaan ei saatu yhteyttä. Yritä hetken kuluttua uudelleen.", null);
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // Fennoa ei aina palauta JSONia.
      }
      if (!res.ok || (body as { status?: string } | null)?.status === "ERROR") {
        if (res.status === 401 || res.status === 403) throw new FennoaError("Fennoa hylkäsi tunnukset. Tarkista API-tunnus ja -avain.", res.status);
        // Fennoan virheteksti kertoo kentän; laskulla on vain taloyhtiön tietoja, ei henkilötietoja.
        const b = body as { message?: unknown; error?: unknown; errors?: unknown } | null;
        const msg = b?.message ?? b?.error ?? b?.errors ?? `HTTP ${res.status}`;
        throw new FennoaError(`Fennoa: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`.slice(0, 300), res.status);
      }
      const r = body as { id?: unknown; data?: { id?: unknown } } | null;
      const id = r?.id ?? r?.data?.id;
      if (id === undefined || id === null) throw new FennoaError("Fennoa ei palauttanut laskutunnusta.", null);
      return { id: String(id) };
    },
  };
}

export function fennoaMode(): string {
  return process.env.FENNOA_MODE?.trim().toLowerCase() || "mock";
}

export function getFennoaClient(): FennoaClient {
  const mode = fennoaMode();
  // Tuotannossa jäljitelmä näyttäisi laskut viedyiksi, vaikka Fennoassa ei ole mitään.
  if (mode === "mock" && process.env.NODE_ENV === "production") {
    throw new FennoaError("Vientiä Fennoaan ei ole otettu käyttöön. Tee laskut Fennoaan erittelyn mukaan.", null);
  }
  if (mode === "mock") return mockFennoa();
  if (mode === "test") {
    const user = process.env.FENNOA_TEST_API_USER?.trim();
    const key = process.env.FENNOA_TEST_API_KEY?.trim();
    if (!user || !key) throw new FennoaError("Fennoan testiyrityksen tunnukset puuttuvat.", null);
    return httpClient(user, key);
  }
  throw new FennoaError("Vientiä Fennoan tuotantoon ei ole otettu käyttöön. Tee laskut Fennoaan erittelyn mukaan.", null);
}

/** Käytössä oleva ympäristö näkymiä varten luomatta asiakasta (null = ei sallittu tila). */
export function fennoaEnvironment(): FennoaEnvironment | null {
  const mode = fennoaMode();
  if (mode === "mock" && process.env.NODE_ENV === "production") return null;
  return mode === "mock" || mode === "test" ? mode : null;
}
