import "server-only";
import { cookies } from "next/headers";
import { verifySignedValue } from "@/lib/security/crypto";

/**
 * Kirjautumisen tunniste (`sub`). Kaksi tilaa:
 *
 * - `AUTH_MODE=auth0`: portfolion Auth0-tenant, sama kuin eSinetissä ja
 *   Reilusopparissa.
 * - `AUTH_MODE=dev`: kehityskirjautuminen, jossa käyttäjä valitaan listasta.
 *   Estetty tuotannossa kokonaan, vaikka muuttuja olisi asetettu väärin.
 */
export const DEV_SESSION_COOKIE = "erappu_dev_session";

export function authMode(): "auth0" | "dev" {
  return process.env.AUTH_MODE === "auth0" ? "auth0" : "dev";
}

export function devLoginAllowed(): boolean {
  return authMode() === "dev" && process.env.NODE_ENV !== "production";
}

export interface SessionIdentity {
  sub: string;
  email: string | null;
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  if (authMode() === "auth0") {
    const { auth0 } = await import("./auth0");
    const session = await auth0.getSession();
    const sub = session?.user?.sub;
    if (!sub) return null;
    return { sub, email: typeof session.user.email === "string" ? session.user.email : null };
  }
  if (!devLoginAllowed()) return null;
  const sub = verifySignedValue((await cookies()).get(DEV_SESSION_COOKIE)?.value);
  return sub ? { sub, email: null } : null;
}
