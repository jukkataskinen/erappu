import { createHmac } from "node:crypto";
import type { Sql } from "@/lib/db/types";

/**
 * Kutsurajoitin julkisille reiteille (QR-lomake). Kiinteä ikkuna kantaan,
 * koska Vercelin palvelinfunktioilla ei ole yhteistä muistia. Ikkunan alku
 * lasketaan epookista, jotta kaikki ikkunan kutsut osuvat samaan riviin
 * (sama ratkaisu kuin Reilusopparissa).
 *
 * Toisin kuin Reilusopparissa, virhe EI päästä kutsua läpi: julkinen lomake
 * ilman rajaa on roskapostin reitti, ja lomakkeen tilapäinen esto on
 * pienempi haitta (ohjeessa on aina päivystysnumero).
 */

export const PUBLIC_FORM_LIMIT = { limit: 5, windowMinutes: 60 } as const;

export function windowStart(now: Date, windowMinutes: number): Date {
  const length = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / length) * length);
}

/** IP-osoitteen avain: HMAC, jottei kantaan jää selväkielistä osoitetta. */
export function clientKey(ip: string | null | undefined): string {
  const secret = process.env.SESSION_SECRET || "erappu-dev-rate-limit";
  return createHmac("sha256", secret).update((ip ?? "unknown").trim().toLowerCase()).digest("hex").slice(0, 32);
}

/** Ensimmäinen osoite x-forwarded-for-otsakkeesta (Vercel lisää asiakkaan osoitteen ensimmäiseksi). */
export function clientIp(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || null;
}

/** Kasvattaa laskuria ja kertoo, onko kutsu sallittu. Aja palvelun roolilla. */
export async function hitRateLimit(
  tx: Sql,
  opts: { organizationId: string; bucket: string; limit: number; windowMinutes: number; now?: Date },
): Promise<{ allowed: boolean; hits: number }> {
  const start = windowStart(opts.now ?? new Date(), opts.windowMinutes);
  const [row] = await tx.query<{ hits: number }>(
    `insert into er_rate_limits as r (organization_id, bucket, window_start, hits) values ($1, $2, $3, 1)
     on conflict (organization_id, bucket, window_start) do update set hits = r.hits + 1
     returning hits`,
    [opts.organizationId, opts.bucket, start.toISOString()],
  );
  // Vanhat ikkunat siivotaan samalla; taulu pysyy pienenä ilman ajastusta.
  await tx.query("delete from er_rate_limits where window_start < $1", [new Date(start.getTime() - 24 * 3600_000).toISOString()]);
  const hits = Number(row.hits);
  return { allowed: hits <= opts.limit, hits };
}
