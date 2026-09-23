import { deflateRawSync } from "node:zlib";

/**
 * Pieni zip-kirjoitin aineiston luovutusta varten (palvelusopimus 10.3).
 *
 * Oma toteutus, koska projektissa ei ole zip-riippuvuutta eikä tarvita muuta
 * kuin tavallinen deflate-pakattu arkisto. Rakenne: jokaiselle tiedostolle
 * paikallinen otsake ja data, lopuksi keskushakemisto ja sen loppumerkintä
 * (PKZIP APPNOTE 4.3). Zip64:ää ei toteuteta, joten arkisto ja yksittäinen
 * tiedosto saavat olla enintään 4 Gt ja tiedostoja enintään 65 535.
 *
 * Nimet kirjoitetaan UTF-8:na ja lippu 0x800 kertoo sen lukijalle, jotta
 * ääkköset säilyvät (Windowsin resurssienhallinta lukee tämän oikein).
 */

export interface ZipEntry {
  /** Polku arkistossa, esim. "dokumentit/yhtiojarjestys.pdf". Kenoviivat eteenpäin. */
  name: string;
  data: Uint8Array;
  /** Muokkausaika; oletuksena nyt. */
  date?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS-aika ja -päivä (zipin alkuperäinen muoto). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Sama nimi kahdesti rikkoisi arkiston lukijoita: lisätään juokseva numero. */
function uniqueNames(entries: ZipEntry[]): string[] {
  const used = new Set<string>();
  return entries.map((e) => {
    const clean = e.name.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.+/g, ".");
    if (!used.has(clean)) {
      used.add(clean);
      return clean;
    }
    const dot = clean.lastIndexOf(".");
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}${ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  });
}

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 65535) throw new Error("Zip-arkistoon mahtuu enintään 65 535 tiedostoa.");
  const names = uniqueNames(entries);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry, i) => {
    const name = Buffer.from(names[i], "utf8");
    const raw = Buffer.from(entry.data);
    const deflated = deflateRawSync(raw);
    // Pakkaamaton tallennus, jos deflate ei pienennä (esim. jpeg tai pdf).
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const { time, date } = dosDateTime(entry.date ?? new Date());
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // tarvittava versio
    local.writeUInt16LE(0x0800, 6); // UTF-8-nimet
    local.writeUInt16LE(stored ? 0 : 8, 8); // 0 = store, 8 = deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // tehty versiolla
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 38); // ulkoiset attribuutit
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  });

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** CSV suomalaiseen tapaan: puolipiste-erotin ja BOM, jotta Excel avaa ääkköset oikein. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): Buffer {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(cell).join(";"), ...rows.map((r) => r.map(cell).join(";"))];
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}
