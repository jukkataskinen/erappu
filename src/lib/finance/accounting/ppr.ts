import type { KirjanpitoAdapteri } from "./types";

/**
 * Adepta PPR -adapteri, käyttöön 1.1.2028 (BLOCKERS 5).
 *
 * TODO(PPR): PPR:n rajapintaa ei vielä ole. Suunnitelman (osio 07) mukaan
 * tulossa: POST /api/v1/asiakkaat (osapuoli → asiakas), POST /api/v1/laskut
 * (laskutusajon rivit myyntilaskuiksi viitteineen, idempotenssiavaimena
 * ajon ja viitteen yhdistelmä) ja GET /api/v1/maksutilanne (vastikereskontra
 * osakeryhmittäin viitteellä). Tunnistus järjestelmien välisellä
 * API-avaimella ympäristömuuttujasta. Ei käytössä ennen kuin rajapinta on.
 */
export const pprAdapter: KirjanpitoAdapteri = {
  name: "ppr",
  async exportBillingRun() {
    throw new Error("PPR-integraatio ei ole vielä käytössä.");
  },
  async importPaymentStatus() {
    throw new Error("PPR-integraatio ei ole vielä käytössä.");
  },
};
