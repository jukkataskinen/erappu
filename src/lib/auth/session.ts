import "server-only";
import { cookies } from "next/headers";
import { verifySignedValue } from "@/lib/security/crypto";

/**
 * Kirjautumisen tunniste (`sub`). Kaksi tilaa:
 *
 * - `AUTH_MODE=auth0`: eRapun oma Auth0-tenant `erappu` (auth0/AJO-OHJE.md).
 * - `AUTH_MODE=dev`: kehityskirjautuminen, jossa käyttäjä valitaan listasta.
 *   Estetty tuotannossa kokonaan, vaikka muuttuja olisi asetettu väärin.
 *   Poikkeus: Vercelin esikatselujulkaisu (VERCEL_ENV=preview), jos
 *   ALLOW_PREVIEW_DEV_LOGIN=1. Esikatselut ovat Vercel-kirjautumisen takana
 *   (Deployment Protection), joten sinne pääsee vain tiimin jäsen. Demodataa varten.
 */
export const DEV_SESSION_COOKIE = "erappu_dev_session";

export function authMode(): "auth0" | "dev" {
  return process.env.AUTH_MODE === "auth0" ? "auth0" : "dev";
}

export function devLoginAllowed(): boolean {
  if (authMode() !== "dev") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.VERCEL_ENV === "preview" && process.env.ALLOW_PREVIEW_DEV_LOGIN === "1";
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
