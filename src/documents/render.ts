/**
 * Asiakirjan renderöinti PDF:ksi (CLAUDE.md 1: eRappu tekee PDF:n itse,
 * eSinetti kerää allekirjoitukset ja sinetöi). Kopioitu Reilusopparista.
 *
 * ===========================================================================
 * DETERMINISMI ON TÄSSÄ TARKOITUS, EI SIVUTUOTE
 *
 * Asiakirjasta lasketaan SHA-256, ja se tiiviste päätyy dokumenttiriville,
 * eSinettiin ja tarkistus-QR:ään. Jos sama sisältö tuottaisi eri tavut
 * joka kerta, tiiviste ei tarkoittaisi mitään: esikatselun ja
 * allekirjoitettavan asiakirjan vertaaminen olisi mahdotonta.
 *
 * Kaksi kohtaa PDF:ssä olisi muuten satunnaista: aikaleimat ja tiedoston
 * tunniste. Aikaleimat hoitaa `DocumentRoot` asiakirjan omasta päiväyksestä,
 * tunnisteen `normalizeFileId` alla.
 * ===========================================================================
 */

import { createHash } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

import { ensureDocumentFonts } from "./fonts";

/**
 * Asiakirjakomponentti.
 *
 * Tyyppi on väljä tarkoituksella: asiakirjat ovat omia komponenttejaan, jotka
 * palauttavat `DocumentRoot`in (`components.tsx`). `ReactElement<DocumentProps>`
 * vaatisi, että juurena on React-PDF:n `Document` — ja juuri sitä ei käytetä
 * suoraan, koska aikaleimat asetetaan `DocumentRoot`issa.
 */
export type DocumentElement = ReactElement<DocumentProps> | ReactElement<Record<string, unknown>>;

export interface RenderedDocument {
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
}

/**
 * Renderöi asiakirjan ja laskee sen tiivisteen.
 *
 * Fontit ladataan tässä eikä moduulin latauksessa: lataus lukee tiedostoja
 * levyltä, eikä sitä pidä tehdä vain siksi, että joku importtaa tämän
 * moduulin.
 */
export async function renderDocumentPdf(element: DocumentElement): Promise<RenderedDocument> {
  // Kesken oleva fonttilataus tuottaisi eri tavut kuin valmis (ks. `fonts.ts`).
  await ensureDocumentFonts();

  const bytes = normalizeFileId(await renderToBuffer(element));

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
  };
}

/** `/ID [<32 heksaa> <32 heksaa>]` PDF:n trailerissa. */
const ID_MARKER = "/ID [<";
const ID_HEX_LENGTH = 32;
/** Ensimmäisen ja toisen tunnisteen välissä on `> <`. */
const ID_SEPARATOR_LENGTH = 3;

/**
 * Korvaa PDF:n satunnaisen tiedostotunnisteen sisällöstä johdetulla.
 *
 * ===========================================================================
 * MIKSI TÄMÄ ON TARPEEN
 *
 * PDF:n trailerissa on `/ID`, jonka pdfkit arpoo joka ajolla. Se on ainoa
 * kohta, jossa kahden identtisen renderöinnin tavut eroavat — kaikki muu on
 * jo vakaata. Ilman tätä asiakirjan SHA-256 muuttuisi joka kerta, eikä
 * esikatselun ja allekirjoitettavan asiakirjan vertaaminen tiivisteellä
 * tarkoittaisi mitään.
 *
 * Tunniste johdetaan asiakirjan omasta sisällöstä: tunnisteen paikka
 * nollataan, lasketaan tiiviste, ja tiivisteen alku kirjoitetaan tunnisteeksi.
 * Tämä on PDF-standardin hengen mukaista — `/ID` on tiedoston tunniste, ja
 * sisällöstä johdettu tunniste on nimenomaan sitä.
 *
 * Molemmat tunnisteet saavat saman arvon. Ne eroaisivat vain, jos tiedostoa
 * olisi päivitetty alkuperäisen luonnin jälkeen; näitä asiakirjoja ei
 * päivitetä, vaan uusi versio on uusi asiakirja.
 * ===========================================================================
 */
export function normalizeFileId(input: Buffer): Uint8Array {
  const buffer = Buffer.from(input);

  const marker = buffer.lastIndexOf(ID_MARKER, buffer.length, "latin1");
  if (marker === -1) return new Uint8Array(buffer);

  const first = marker + ID_MARKER.length;
  const second = first + ID_HEX_LENGTH + ID_SEPARATOR_LENGTH;
  if (second + ID_HEX_LENGTH > buffer.length) return new Uint8Array(buffer);

  const zeros = "0".repeat(ID_HEX_LENGTH);
  buffer.write(zeros, first, "latin1");
  buffer.write(zeros, second, "latin1");

  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, ID_HEX_LENGTH);
  buffer.write(digest, first, "latin1");
  buffer.write(digest, second, "latin1");

  return new Uint8Array(buffer);
}

/** Tiiviste valmiista tavuista. Sama laskenta kuin eSinetissä. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
