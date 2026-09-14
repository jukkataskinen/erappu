import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Salaus, tiivisteet ja tokenit.
 *
 * Kenttäsalaus (AES-256-GCM) tehdään sovelluksessa eikä pgcryptolla, koska
 * kyselyparametrit päätyvät kannan lokeihin (sama linjaus kuin Reilusopparissa).
 * Kehitysympäristössä käytetään kiinteää avainta, tuotannossa avain on pakollinen.
 */

const DEV_KEY = Buffer.alloc(32, 7);

function keyFrom(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error(`${envName} puuttuu`);
    return DEV_KEY;
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error(`${envName} on väärän mittainen (32 bittiä base64)`);
  return bytes;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom("FIELD_ENCRYPTION_KEY"), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

export function decryptField(stored: string): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Salattu arvo on tuntemattomassa muodossa.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom("FIELD_ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** Henkilötunnuksen HMAC vertailuun ilman selväkielistä tunnusta (sama malli kuin eSinetissä). */
export function hetuHmac(hetu: string): string {
  return createHmac("sha256", keyFrom("HETU_PEPPER")).update(hetu.trim().toUpperCase()).digest("hex");
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Satunnainen token linkkeihin. Kantaan tallennetaan vain `sha256Hex(token)`. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** HMAC-allekirjoitettu arvo evästeisiin (kehityskirjautuminen, valittu organisaatio). */
export function signValue(value: string): string {
  const mac = createHmac("sha256", keyFrom("SESSION_SECRET")).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function verifySignedValue(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const expected = Buffer.from(signValue(value).slice(idx + 1));
  const actual = Buffer.from(signed.slice(idx + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return value;
}
