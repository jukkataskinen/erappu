import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "@/lib/security/crypto";
import { supabaseHeaders, supabaseSecretKey } from "@/lib/config/deploy-env";

/**
 * Tiedostovarasto. Paikallisesti `.data/files`, tuotannossa Supabase Storage
 * (yksityinen bucket `documents`). Polku muodostetaan aina palvelimella:
 * `{organisaatio}/{yhtiö tai _}/{uuid}/{siistitty nimi}`. Käyttäjän antamaa
 * polkua ei käytetä koskaan.
 */

const LOCAL_ROOT = path.join(process.cwd(), ".data", "files");
const BUCKET = "documents";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function storageRequest(storagePath: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) {
  const key = supabaseSecretKey();
  if (!process.env.SUPABASE_URL || !key) throw new Error("SUPABASE_URL tai Supabasen salainen avain puuttuu");
  return fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(storagePath)}`, {
    ...init,
    headers: { ...supabaseHeaders(key), ...init.headers },
  });
}

const ALLOWED: Record<string, string[]> = {
  "application/pdf": ["%PDF"],
  "image/jpeg": ["\xff\xd8\xff"],
  "image/png": ["\x89PNG"],
  "image/webp": ["RIFF"],
  "text/csv": [],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["PK"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["PK"],
};

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "tiedosto";
  // NFKC eikä NFKD: hajotettu ä (a + yhdistävä merkki) menetti pisteensä
  // suodatuksessa, ja "Tilinpäätös" tallentui muotoon "Tilinpaatos".
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\w.\-äöåÄÖÅ ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "tiedosto";
}

/** Varaston avaimeen vain ASCII (Supabase Storage ei hyväksy kaikkia merkkejä); näyttönimi säilyy ennallaan. */
function storageKeyName(fileName: string): string {
  // Peräkkäiset pisteet yhdeksi: readStoredFile hylkää polut, joissa on "..".
  const ascii = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "").replace(/\.{2,}/g, ".");
  return ascii || "tiedosto";
}

/** Tarkistaa tyypin tiedoston alusta eikä pelkästä selaimen ilmoittamasta tyypistä. */
export function detectAllowedType(bytes: Buffer, declared: string): string | null {
  const magics = ALLOWED[declared];
  if (!magics) return null;
  if (magics.length === 0) return declared;
  const head = bytes.subarray(0, 8).toString("latin1");
  return magics.some((m) => head.startsWith(m)) ? declared : null;
}

export interface StoredFile {
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  fileName: string;
}

export async function storeFile(opts: { organizationId: string; companyId?: string | null; fileName: string; mimeType: string; bytes: Buffer }): Promise<StoredFile> {
  if (opts.bytes.length > MAX_UPLOAD_BYTES) throw new Error("Tiedosto on liian suuri (enintään 20 Mt).");
  const mime = detectAllowedType(opts.bytes, opts.mimeType);
  if (!mime) throw new Error("Tiedostotyyppiä ei sallita.");
  const fileName = sanitizeFileName(opts.fileName);
  const storagePath = `${opts.organizationId}/${opts.companyId ?? "_"}/${randomUUID()}/${storageKeyName(fileName)}`;

  if (process.env.STORAGE_DRIVER === "supabase") {
    const res = await storageRequest(storagePath, {
      method: "POST",
      headers: { "Content-Type": mime, "x-upsert": "false" },
      body: new Uint8Array(opts.bytes),
    });
    if (!res.ok) throw new Error("Tiedoston tallennus epäonnistui.");
  } else {
    const full = path.join(LOCAL_ROOT, storagePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, opts.bytes);
  }
  return { storagePath, sha256: sha256Hex(opts.bytes), sizeBytes: opts.bytes.length, mimeType: mime, fileName };
}

/** Lukee tiedoston. Kutsujan vastuulla on tarkistaa oikeus dokumenttiriviin (RLS) ensin. */
export async function readStoredFile(storagePath: string): Promise<Buffer> {
  if (storagePath.includes("..")) throw new Error("Virheellinen polku.");
  if (process.env.STORAGE_DRIVER === "supabase") {
    const res = await storageRequest(storagePath);
    if (!res.ok) throw new Error("Tiedostoa ei löytynyt.");
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(LOCAL_ROOT, storagePath));
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  if (storagePath.includes("..")) return;
  if (process.env.STORAGE_DRIVER === "supabase") {
    await storageRequest(storagePath, { method: "DELETE" });
    return;
  }
  await unlink(path.join(LOCAL_ROOT, storagePath)).catch(() => undefined);
}
