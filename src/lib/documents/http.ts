/**
 * Lomakkeen lähetys reitille (ei server actionia) ei saa Nextin omaa
 * alkuperätarkistusta, joten se tehdään itse: Origin-otsakkeen isännän on
 * vastattava pyynnön isäntää. Selaimet lähettävät Originin aina POST-lomakkeissa.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}
