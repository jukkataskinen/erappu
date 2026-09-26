import type { LetterRecipientRow } from "./jobs";

/** Pitkä nimi näyttää koetulosteessa, miten rivi pienennetään kenttään. */
export const SAMPLE_RECIPIENT: LetterRecipientRow = {
  partyId: "00000000-0000-0000-0000-000000000000",
  name: "Esimerkki",
  addressLines: ["Maija-Liisa Esimerkki-Pitkänimi-Vastaanottaja", "Esimerkkikatu 12 B 34", "40100 JYVÄSKYLÄ"],
  reference: "Kohde: A 1",
};
