/**
 * Valmiit tiedoteluonnokset vuosikellon asukasviestintätehtäviin (Jukan
 * vuosikellomalli 17.9.2026, sisältö tehtäväkuvauksista
 * src/lib/tasks/annual-cycle.ts). Hakasulkeissa olevat kohdat isännöitsijä
 * täydentää tai poistaa ennen julkaisua; julkaisu estyy, jos niitä jää.
 */

export interface AnnouncementDraft {
  title: string;
  body: string;
}

export const DRAFT_KEYS = ["communication_spring", "communication_summer", "communication_autumn", "communication_winter", "general_meeting_bulletin", "winter_preparation"] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];

export function isDraftKey(value: string | null | undefined): value is DraftKey {
  return !!value && (DRAFT_KEYS as readonly string[]).includes(value);
}

/** Täydennettävä kohta: [ ... ]. */
export const PLACEHOLDER = /\[[^\]\n]{1,120}\]/;

export function hasPlaceholders(text: string): boolean {
  return PLACEHOLDER.test(text);
}

const SIGNATURE = (manager: string | null) => (manager ? `\n\nTerveisin\n${manager}\nisännöitsijä` : "\n\nTerveisin\nisännöinti");

export function announcementDraft(key: DraftKey, opts: { year: number; managerName: string | null }): AnnouncementDraft {
  const sign = SIGNATURE(opts.managerName);
  switch (key) {
    case "communication_spring":
      return {
        title: `Kevättiedote ${opts.year}`,
        body: [
          "Hyvät asukkaat,",
          `Katsaus edelliseen vuoteen: [tärkeimmät tehdyt korjaukset ja hankkeet].`,
          `Energiankulutus: lämmön kulutus oli [määrä] MWh ja sähkön [määrä] kWh, muutos edellisvuoteen [prosenttia]. [Poikkeamat ja niiden syyt.]`,
          `Kevättalkoot pidetään [päivä] klo [aika]. Kokoonnumme [paikka]. Talkoissa haravoidaan, siivotaan pihat ja yhteiset tilat. Yhtiö tarjoaa [tarjoilu].`,
          "Lämmityskausi päättyy kevään edetessä. Käännä korvausilmaventtiilit kesäasentoon ja puhdista niiden suodattimet. Pihavalojen ajastus muutetaan valoisan ajan mukaiseksi.",
        ].join("\n\n") + sign,
      };
    case "communication_summer":
      return {
        title: `Kesätiedote ${opts.year}`,
        body: [
          "Hyvät asukkaat,",
          "Kastelethan pihakasveja mahdollisuuksien mukaan sadevedellä. [Sadevesitynnyrien sijainti.]",
          "Käännä patterien termostaatit kesän aikana välillä ääriasentoon ja takaisin, jotta venttiilit eivät jumitu.",
          "Helteellä huoneistoa viilentää, kun pidät verhot ja sälekaihtimet kiinni päivällä ja tuuletat viileään aikaan aamulla ja illalla.",
          "[Kesän korjaukset ja niiden aikataulu.]",
        ].join("\n\n") + sign,
      };
    case "communication_autumn":
      return {
        title: `Syystiedote ${opts.year}`,
        body: [
          "Hyvät asukkaat,",
          "Lämmityskausi on alkanut. Suositeltava huonelämpötila on noin 21 astetta. Patterin termostaatti säätää lämpöä itse: älä peitä patteria verhoilla tai huonekaluilla, jotta termostaatti toimii oikein.",
          "Tarkista ikkunoiden ja ovien tiivisteet. Jos huomaat vetoa tai tiivisteen vaurion, tee huoltopyyntö asukasportaalissa.",
          "[Syksyn korjaukset, pihatyöt ja muut ajankohtaiset asiat.]",
        ].join("\n\n") + sign,
      };
    case "communication_winter":
      return {
        title: `Talvitiedote ${opts.year}`,
        body: [
          "Hyvät asukkaat,",
          "Käännä korvausilmaventtiilit talviasentoon, mutta älä sulje niitä kokonaan: ilmanvaihto tarvitsee korvausilmaa myös talvella.",
          "Tuuleta lyhyesti ja tehokkaasti ristivedolla muutaman minuutin ajan. Pitkä tuuletus viilentää rakenteita ja lisää lämmityskuluja.",
          "Lumityöt ja hiekoitus: [huoltoyhtiö ja yhteystiedot]. Siirrä autosi aurauksen ajaksi [ohje].",
        ].join("\n\n") + sign,
      };
    case "general_meeting_bulletin":
      return {
        title: `Yhtiökokouksen päätökset ${opts.year}`,
        body: [
          "Hyvät osakkaat ja asukkaat,",
          "Varsinainen yhtiökokous pidettiin [päivämäärä]. Kokouksen keskeiset päätökset:",
          "- Tilinpäätös vahvistettiin ja vastuuvapaus myönnettiin tilikaudelta [tilikausi].\n- Hallitukseen valittiin [nimet].\n- Hoitovastike on [euroa/m² tai euroa/osake] kuukaudessa [alkaen].\n- [Muut päätökset, esimerkiksi korjaushankkeet.]",
          "Pöytäkirja on nähtävissä asukasportaalin dokumenteissa, kun se on tarkastettu.",
        ].join("\n\n") + sign,
      };
    case "winter_preparation":
      return {
        title: `Talveen varautuminen ${opts.year}`,
        body: [
          "Hyvät asukkaat,",
          "Taloyhtiössä tehdään syksyn kiinteistö- ja pihakierros [päivämäärä]. Kierroksella tarkistetaan räystäät ja kourut, ulkovalaistus sekä lumitöiden ja hiekoituksen valmius.",
          "Irrota ulkohanoihin liitetyt letkut ja ilmoita, jos huomaat vesikalusteissa jäätymisriskin (esimerkiksi kylmä ulkoseinä tai vetoisa tila).",
          "[Talven lumityö- ja pysäköintiohjeet.]",
        ].join("\n\n") + sign,
      };
  }
}
