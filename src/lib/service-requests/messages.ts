import { CATEGORY_LABEL, STATUS_LABEL, type Category, type RequestStatus } from "./labels";

/**
 * Ilmoitusten tekstit. Puhdasta logiikkaa (testattava). Viesteihin ei
 * kirjoiteta ilmoittajan tai osakkaiden henkilötietoja eikä pyynnön vapaata
 * kuvausta, koska sähköposti kulkee kolmansien palvelimien kautta: vain
 * numero, kategoria, tila ja linkki.
 */

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export interface MessageText {
  subject: string;
  body: string;
}

export function statusChangeMessage(opts: {
  number: number;
  category: Category;
  companyName: string;
  status: RequestStatus;
  portalRequestId?: string | null;
  baseUrl?: string;
}): MessageText {
  const base = opts.baseUrl ?? appBaseUrl();
  const lines = [
    "Hei,",
    "",
    `huoltopyyntösi #${opts.number} (${CATEGORY_LABEL[opts.category]}, ${opts.companyName}) tila on nyt: ${STATUS_LABEL[opts.status]}.`,
  ];
  if (opts.status === "done") lines.push("", "Jos vika ei korjaantunut, voit avata pyynnön uudelleen.");
  if (opts.portalRequestId) lines.push("", `Näet pyynnön tiedot portaalissa: ${base}/portaali/huoltopyynnot/${opts.portalRequestId}`);
  lines.push("", "Tämä on automaattinen viesti isännöinnistä.");
  return { subject: `Huoltopyyntö #${opts.number}: ${STATUS_LABEL[opts.status]}`, body: lines.join("\n") };
}

export function receivedConfirmationMessage(opts: { number: number; category: Category; companyName: string }): MessageText {
  return {
    subject: `Huoltopyyntö #${opts.number} vastaanotettu`,
    body: [
      "Hei,",
      "",
      `huoltopyyntösi #${opts.number} (${CATEGORY_LABEL[opts.category]}, ${opts.companyName}) on vastaanotettu. Saat tiedon, kun pyynnön tila muuttuu.`,
      "",
      "Kiireellisissä vioissa, kuten vesivuodoissa, soita aina kiinteistön päivystysnumeroon.",
      "",
      "Tämä on automaattinen viesti isännöinnistä.",
    ].join("\n"),
  };
}

export const PROVIDER_LINK_DAYS = 30;

/**
 * Lyhyt tilausviesti jaettavaksi pikaviestimessä. Viestiin ei tule osoitetta,
 * huoneistoa eikä asukkaan tietoja, koska ne jäisivät pikaviestimen
 * keskusteluhistoriaan; ne näkyvät vasta linkin takana.
 */
export function providerShareText(opts: { number: number; category: Category; companyName: string; urgent: boolean; token: string; baseUrl?: string }): {
  link: string;
  text: string;
} {
  const link = `${opts.baseUrl ?? appBaseUrl()}/tehtava/${opts.token}`;
  const text = [
    `${opts.urgent ? "KIIREELLINEN työtilaus" : "Työtilaus"} #${opts.number}: ${opts.companyName}, ${CATEGORY_LABEL[opts.category].toLowerCase()}.`,
    `Tiedot, kuittaus ja kustannus: ${link}`,
    `Linkki on voimassa ${PROVIDER_LINK_DAYS} päivää. Älä välitä sitä eteenpäin.`,
  ].join("\n");
  return { link, text };
}

/** WhatsApp-jakolinkki. Suomalainen numero muunnetaan kansainväliseen muotoon; ilman numeroa WhatsApp kysyy vastaanottajan. */
export function whatsappShareUrl(text: string, phone?: string | null): string {
  const digits = phone ? phone.replace(/[^0-9+]/g, "") : "";
  const international = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? `358${digits.slice(1)}` : digits;
  const target = /^[1-9][0-9]{7,14}$/.test(international) ? international : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
}

export function providerOrderMessage(opts: {
  number: number;
  category: Category;
  companyName: string;
  address: string | null;
  urgent: boolean;
  token: string;
  baseUrl?: string;
}): MessageText {
  const base = opts.baseUrl ?? appBaseUrl();
  return {
    subject: `${opts.urgent ? "KIIREELLINEN työtilaus" : "Työtilaus"} #${opts.number}: ${opts.companyName}`,
    body: [
      "Hei,",
      "",
      `isännöinti tilaa työn kohteeseen ${opts.companyName}${opts.address ? `, ${opts.address}` : ""}.`,
      `Aihe: ${CATEGORY_LABEL[opts.category]}.`,
      "",
      `Tehtävän tiedot, kuittaus ja kustannuksen kirjaus: ${base}/tehtava/${opts.token}`,
      `Linkki on voimassa ${PROVIDER_LINK_DAYS} päivää. Älä välitä linkkiä eteenpäin.`,
      "",
      "Tämä on automaattinen viesti isännöinnistä.",
    ].join("\n"),
  };
}
