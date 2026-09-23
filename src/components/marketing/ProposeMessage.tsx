"use client";

import { useState } from "react";

/**
 * "Ehdota eRappua taloyhtiöllesi": valmis viesti, jonka hallituksen jäsen
 * lähettää isännöitsijälle tai puheenjohtajalle. Sivuston tehtävä ei ole
 * sulkea kauppaa vaan saada ehdotus liikkeelle.
 */
const MESSAGE = `Hei,

löysin eRapun (www.erappu.fi). Se on taloyhtiön ja isännöinnin yhteinen palvelu, jossa pöytäkirjat, asiakirjat, huoneistotiedot, vuosikello ja huoltopyynnöt ovat samassa paikassa. Hallitus ja osakkaat näkevät tiedot omasta näkymästään, ja pöytäkirjat allekirjoitetaan pankkitunnuksilla.

Hinta on taloyhtiökohtainen: 14,90 € kuukaudessa yhtiöltä ja 1,50 € huoneistolta, vähintään 24,90 € kuukaudessa (alv 0, vuosimaksulla). Laskuri on osoitteessa www.erappu.fi/hinnat.

Voisitko katsoa, sopisiko tämä meille? Esittelyn voi pyytää osoitteesta www.erappu.fi/yhteystiedot.`;

export function ProposeMessage() {
  const [copied, setCopied] = useState(false);
  const mailto = `mailto:?subject=${encodeURIComponent("Ehdotus: eRappu taloyhtiöllemme")}&body=${encodeURIComponent(MESSAGE)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(MESSAGE);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-4">
      <textarea
        readOnly
        value={MESSAGE}
        rows={12}
        aria-label="Valmis viesti isännöitsijälle"
        className="w-full rounded-[var(--radius-panel)] border border-line bg-paper p-4 text-[15px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-4">
        <a
          href={mailto}
          className="inline-flex items-center justify-center rounded-full bg-ink px-7 py-3.5 font-medium text-paper transition-colors hover:bg-ink-strong"
        >
          Avaa sähköpostissa
        </a>
        <button type="button" onClick={copy} className="text-[15px] underline underline-offset-4">
          {copied ? "Kopioitu leikepöydälle" : "Kopioi teksti"}
        </button>
      </div>
    </div>
  );
}
