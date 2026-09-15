import type { ContractTemplate } from "./types";

/**
 * Lumityö- ja hiekoitussopimus. Jukan oma pohja (auraussopimus.docx).
 *
 * Teksti on alkuperäisen mukainen seuraavin muutoksin (DECISIONS.md
 * 2026-09-15, Jukan tarkistettavat): täyttökentät → kentät, kohtien
 * numerointi juoksevaksi (alkuperäisestä puuttui kohta 6), kirjoitusvirheet
 * korjattu, kohdassa 10 "yrittäjän" → "urakoitsijan", ja "kahtena saman
 * sisältöisenä kappaleena" korvattu sähköisen allekirjoituksen lauseella.
 */

/** Talvikausi päättyy 30.4.: toukokuusta alkaen oletus on seuraavan vuoden huhtikuu. */
export function seasonEnd(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${month >= 5 ? year + 1 : year}-04-30`;
}

export const SNOW_PLOUGHING: ContractTemplate = {
  key: "snow-ploughing",
  version: 1,
  name: "Lumityö- ja hiekoitussopimus",
  title: "Lumityö- ja hiekoitussopimus",
  category: "maintenance_service",
  description: "Vuosittain toistuva auraus- ja hiekoitussopimus taloyhtiön ja urakoitsijan välille. Hinnat ja voimassaolo ovat yhteiset, auraus, hiekoitus, kohde ja tilaajan edustaja yhtiökohtaiset.",
  approved: true,
  noticeMonths: 1,
  endsOnField: "valid_until",
  documentTitle: "Lumityösopimus {{provider_name}} {{valid_until}}",
  contractDescription:
    "Lumityö- ja hiekoitussopimus: auraus {{ploughing}} ({{price_ploughing}} €/kerta), hiekoitus {{sanding}} ({{price_sanding}} €/kerta), hinnat alv 0 %. Kohde: {{site_address}}. Massaluonti: {{batch_title}}.",
  fields: [
    { key: "provider_id", label: "Urakoitsija", type: "provider", scope: "batch", required: true },
    { key: "valid_until", label: "Voimassa asti", type: "date", scope: "batch", required: true, default: seasonEnd },
    { key: "price_ploughing", label: "Auraus €/kerta", type: "money", scope: "batch", required: true, overridable: true, hint: "Alv 0 %" },
    { key: "price_sanding", label: "Hiekoitus €/kerta", type: "money", scope: "batch", required: true, overridable: true, hint: "Alv 0 %" },
    { key: "provider_representative", label: "Urakoitsijan edustaja", type: "text", scope: "batch", required: true, source: "provider.name", hint: "Allekirjoittaa urakoitsijan puolesta" },
    { key: "provider_representative_email", label: "Urakoitsijan edustajan sähköposti", type: "email", scope: "batch", required: true, source: "provider.email" },
    { key: "ploughing", label: "Auraus", type: "boolean", scope: "company", required: true, default: true },
    { key: "sanding", label: "Hiekoitus", type: "boolean", scope: "company", required: true, default: true },
    { key: "client_representative", label: "Tilaajan edustaja", type: "text", scope: "company", required: true, source: "representative.name" },
    { key: "client_representative_email", label: "Tilaajan edustajan sähköposti", type: "email", scope: "company", required: true, source: "representative.email" },
    { key: "site_address", label: "Kohteen osoite", type: "text", scope: "company", required: true, source: "company.address" },
  ],
  sections: [
    {
      heading: "SOPIJAPUOLET",
      keyValues: [
        { label: "Tilaaja", value: "{{company_name}}, {{company_business_id}}" },
        { label: "Edustajanaan", value: "{{client_representative}}" },
        { label: "Urakoitsija", value: "{{provider_name}}, {{provider_business_id}}" },
      ],
    },
    {
      heading: "TYÖKOHDE",
      paragraphs: [
        "Urakoitsija sitoutuu suorittamaan",
        "lumenaurauksen {{ploughing}}",
        "hiekoituksen {{sanding}}",
        "on tilaajan omistamien kiinteistöjen piha-alueilla.",
        "{{site_address}}",
      ],
    },
    {
      heading: "TÖIDEN SUORITTAMINEN",
      paragraphs: [
        "Urakoitsijan hintoihin pitää sisältyä päivystäminen. Auraus tapahtuu ilman erikseen sovittavaa senttimetrirajaa silloin kun tarvetta on. Tarvittaessa käytännöstä keskustellaan tilaajan ja urakoitsijan kanssa.",
        "Lumen poiskuljettamisesta päättää tilaaja. Urakoitsijan velvollisuus on ilmoittaa isännöitsijälle, milloin tarvetta lumen poiskuljettamiseen on.",
      ],
    },
    {
      heading: "SOPIMUKSEN VOIMASSAOLOAIKA",
      paragraphs: ["Sopimus tulee voimaan heti kun se on molemmin puolin allekirjoitettu ja se on voimassa {{valid_until}} saakka."],
    },
    {
      heading: "URAKOITSIJALLE MAKSETTAVA KORVAUS",
      paragraphs: [
        "Tilaaja on velvollinen korvaamaan urakoitsijalle työn suorittamisesta seuraavasti:",
        "Auraus {{price_ploughing}} euroa/kerta",
        "Hiekoitus {{price_sanding}} euroa/kerta",
        "Hinnat ilman arvonlisäveroa (alv 0 %). Kulloinkin voimassa oleva arvonlisävero voidaan lisätä hintoihin.",
      ],
    },
    {
      heading: "IRTISANOMISAIKA",
      paragraphs: [
        "Sopimus voidaan irtisanoa, irtisanomisaika on 1 kuukautta kummallakin sopijapuolella. Irtisanominen on suoritettava kirjallisesti. Mikäli urakoitsija toistuvasti rikkoo tämän sopimuksen työsuoritusvelvollisuuttaan tai työn laadussa on jatkuvasti puutteita, tilaaja voi sanoa sopimuksen välittömästi irti.",
      ],
    },
    {
      heading: "MUIDEN URAKOITSIJOIDEN KÄYTTÖ",
      paragraphs: [
        "Mikäli urakoitsija laiminlyö tahallisesti tai muutoin 2 ja 3 kohdassa määritellyt tehtävänsä ja henkilö- ja liikenneturvallisuus sitä vaativat, tilaaja on oikeutettu käyttämään toista urakoitsijaa. Ennen kuin toista urakoitsijaa käytetään, on tilaajan annettava määräys sopimuksen tehneelle urakoitsijalle työn suorittamisesta. Mikäli työtä ei ole määräyksen jälkeen aloitettu kuuden tunnin kuluessa, tilaaja voi teettää työn toisella urakoitsijalla.",
      ],
    },
    {
      heading: "KÄYTETTÄVÄT KONEET",
      paragraphs: [
        "Urakoitsijan tulee käyttää työn suorituksessa työhön soveltuvia koneita ja laitteita. Ylivoimaisen esteen sattuessa urakoitsija on oikeutettu käyttämään myös muunlaisia koneita ja laitteita. Tästä on kuitenkin viipymättä ilmoitettava tilaajalle.",
      ],
    },
    {
      heading: "URAKOITSIJAN VASTUU VAHINKOTAPAUKSISSA",
      paragraphs: [
        "Urakoitsija vastaa tilaajalle aiheutuneista vahingoista ja haitoista, jotka osoitetaan johtuvan urakoitsijan huolimattomuudesta, ei kuitenkaan välillisiä vahinkoja ja haittoja. Jos kyseessä on tahallisuus tai törkeä tuottamus, urakoitsija vastaa myös tilaajalle aiheutuneista välillisistä vahingoista. Urakoitsija vastaa vahingonkorvauslain mukaisesti ulkopuoliselle aiheutuneista vahingoista, jotka osoitetaan aiheutuneen urakoitsijan huolimattomuudesta.",
        "Mahdollisista vahinkotapauksista on välittömästi ilmoitettava tilaajalle.",
      ],
    },
    {
      heading: "RIITAISUUKSIEN RATKAISEMINEN",
      paragraphs: [
        "Tätä sopimusta koskevat mahdolliset riitaisuudet pyritään ratkaisemaan ensisijaisesti neuvottelemalla. Toissijaisesti riitaisuudet voidaan jättää paikallisen käräjäoikeuden ratkaistaviksi.",
      ],
    },
    {
      heading: "SOPIMUKSEN SIIRTÄMINEN",
      paragraphs: [
        "Tämän sopimuksen tarkoittamien työkohteiden omistuksen siirtyessä kolmannelle osapuolelle, sopimus voidaan siirtää näiden työkohteiden osalta uuden omistajan nimiin urakoitsijaa kuulematta.",
        "Sopimus allekirjoitetaan sähköisesti, ja kumpikin sopijapuoli saa allekirjoitetun ja sinetöidyn kappaleen.",
      ],
    },
  ],
  signatureRoles: [
    { role: "Tilaaja", name: "{{company_name}}" },
    { role: "Tilaajan edustaja", name: "{{client_representative}}" },
    { role: "Urakoitsija", name: "{{provider_name}}" },
    { role: "Urakoitsijan edustaja", name: "{{provider_representative}}" },
  ],
  signers: [
    { roleLabel: "Tilaajan edustaja", name: "{{client_representative}}", email: "{{client_representative_email}}" },
    { roleLabel: "Urakoitsija", name: "{{provider_representative}}", email: "{{provider_representative_email}}" },
  ],
  defaultBatchTitle: (today) => {
    const end = Number(seasonEnd(today).slice(0, 4));
    return `Lumityösopimukset ${end - 1}–${end}`;
  },
  exampleValues: {
    company_name: "As Oy Esimerkki",
    company_business_id: "1234567-1",
    provider_name: "Esimerkkiurakointi Oy",
    provider_business_id: "7654321-2",
    batch_title: "Lumityösopimukset 2026–2027",
    provider_id: "00000000-0000-4000-8000-000000000000",
    valid_until: "2027-04-30",
    price_ploughing: "45.00",
    price_sanding: "40.00",
    provider_representative: "Urho Urakoitsija",
    provider_representative_email: "urho@example.test",
    ploughing: true,
    sanding: true,
    client_representative: "Paula Puheenjohtaja",
    client_representative_email: "paula@example.test",
    site_address: "Esimerkkitie 1, 41660 Toivakka",
  },
};
