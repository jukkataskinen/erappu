import { timingSafeEqual } from "node:crypto";

/**
 * Ajastetun tehtävän suojaus. Tuotannossa vaaditaan aina
 * `Authorization: Bearer ${CRON_SECRET}`; ilman salaisuutta reitti on kiinni.
 * Kehityksessä (NODE_ENV != production) salaisuuden puuttuessa ajo sallitaan,
 * jotta jonon voi purkaa paikallisesti.
 */
export function isCronAuthorized(authorization: string | null, env: { CRON_SECRET?: string; NODE_ENV?: string }): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return env.NODE_ENV !== "production";
  if (!authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length).trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
