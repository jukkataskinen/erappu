import type { HtjClient } from "./client";
import { createMockHtjClient } from "./mock";
import { HtjError } from "./types";

export type { HtjClient } from "./client";
export { withRequestLog } from "./log";
export * from "./types";

/**
 * HTJ-asiakkaan valinta. `HTJ_MODE=mock` (oletus) käyttää kuvitteellista
 * dataa. `HTJ_MODE=mml` vaatii varmenteen; jos se puuttuu, heitetään
 * konfiguraatiovirhe eikä pudota hiljaa jäljitelmään, jotta tuotannossa ei
 * koskaan vertailla rekisteriä kuvitteelliseen dataan.
 */
const globalForHtj = globalThis as unknown as { __erappuHtj?: Promise<HtjClient> };

export function getHtjClient(): Promise<HtjClient> {
  if (!globalForHtj.__erappuHtj) {
    globalForHtj.__erappuHtj = (async () => {
      const mode = process.env.HTJ_MODE ?? "mock";
      if (mode === "mml") {
        const { createMmlHtjClient } = await import("./mml");
        return createMmlHtjClient();
      }
      if (mode !== "mock") throw new HtjError(`Tuntematon HTJ_MODE: ${mode}`, "config");
      return createMockHtjClient();
    })();
    globalForHtj.__erappuHtj.catch(() => {
      globalForHtj.__erappuHtj = undefined;
    });
  }
  return globalForHtj.__erappuHtj;
}
