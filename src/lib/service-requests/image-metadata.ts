/**
 * JPEG-kuvan metatietojen poisto palvelimella. Puhelimen kuvassa EXIF
 * sisältää usein GPS-sijainnin, joka paljastaisi esimerkiksi kuvaajan kodin.
 * Selain pienentää kuvan canvasilla (joka pudottaa EXIFin), mutta sen voi
 * ohittaa, joten poisto tehdään myös täällä.
 *
 * Poistetaan APP1 (EXIF, XMP), APP13 (IPTC) ja kommentit. APP0 (JFIF),
 * APP2 (värit) ja APP14 (Adobe) jätetään, koska ilman niitä kuva voi näkyä
 * väärin värein. Jos rakenne ei ole odotettu, palautetaan null eikä kuvaa
 * tallenneta.
 */
const STRIP = new Set([0xe1, 0xed, 0xfe]);

export function stripJpegMetadata(input: Buffer): Buffer | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const parts: Buffer[] = [input.subarray(0, 2)];
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) return null;
    let marker = input[i + 1];
    // Täytebaitit (FF FF ...) ennen merkkiä.
    while (marker === 0xff && i + 2 < input.length) {
      i++;
      marker = input[i + 1];
    }
    if (marker === undefined) return null;
    if (marker === 0xda) {
      // Kuvadata alkaa: loppu kopioidaan sellaisenaan.
      parts.push(input.subarray(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xd9) {
      parts.push(input.subarray(i, i + 2));
      return Buffer.concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(input.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > input.length) return null;
    const length = input.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > input.length) return null;
    if (!STRIP.has(marker)) parts.push(input.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_STRIP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

/** PNG:stä poistetaan EXIF- ja tekstilohkot. Virheellinen rakenne → null. */
export function stripPngMetadata(input: Buffer): Buffer | null {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts: Buffer[] = [input.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= input.length) {
    const length = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + length;
    if (end > input.length) return null;
    if (!PNG_STRIP.has(type)) parts.push(input.subarray(i, end));
    i = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  return null;
}

/** Poistaa metatiedot tuetuista kuvatyypeistä. Muut tyypit hylätään (null). */
export function stripImageMetadata(input: Buffer, mimeType: string): Buffer | null {
  if (mimeType === "image/jpeg") return stripJpegMetadata(input);
  if (mimeType === "image/png") return stripPngMetadata(input);
  return null;
}
