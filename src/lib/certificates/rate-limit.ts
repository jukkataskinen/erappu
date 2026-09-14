/**
 * Kevyt kutsurajoitin julkiselle todistustilauslomakkeelle.
 *
 * Prosessin muistissa: riittää estämään lomakkeen toistuvan lähettämisen
 * samasta osoitteesta tai samalla linkillä. Useamman palvelininstanssin
 * tuotannossa tämä ei ole tiukka raja (sama rajoitus kuin eSinetin
 * Upstash-rajoittimen puuttuessa); tilaukset tarkistetaan joka tapauksessa
 * käsin ennen todistuksen tekemistä.
 */

const store = (globalThis as unknown as { __erappuRateLimit?: Map<string, number[]> }).__erappuRateLimit ?? new Map<string, number[]>();
(globalThis as unknown as { __erappuRateLimit?: Map<string, number[]> }).__erappuRateLimit = store;

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  if (store.size > 5000) {
    for (const [k, v] of store) if (v.every((t) => now - t >= windowMs)) store.delete(k);
  }
  return true;
}

export function resetRateLimitForTests(): void {
  store.clear();
}
