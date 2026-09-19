import { z } from "zod";

/**
 * Yhtiökohtainen muutostyöohje osakkaille (pohjan versio 1).
 *
 * Lain perusta: asunto-osakeyhtiölaki 1599/2009 5 luku (Finlexin avoin data,
 * tarkistettu 2026-09-19):
 * - 5:1 oikeus muutostyöhön omalla kustannuksella, hyvä rakennustapa
 * - 5:2 kirjallinen ennakkoilmoitus hallitukselle tai isännöitsijälle;
 *   sisältö ja käsittelykulut 4:7 2–4 mom mukaan
 * - 5:3 ehdot ja kielto, lisäehdot työn aikana
 * - 5:4 työtä ei saa aloittaa ennen kohtuullista käsittelyaikaa
 * - 5:5 yhtiöjärjestyksen muutos ja viranomaislupa osakkaan kustannuksella
 * - 5:7 valvonta; osakas vastaa tarpeellisista ja kohtuullisista valvontakuluista
 * - 5:8 muutostyö yhtiön hallinnassa olevissa tiloissa vaatii suostumuksen
 * - 7:27 ja 7:28 tiedot isännöitsijäntodistukseen ja säilytys, 24 luku vahingot
 *
 * Työlajikohtaiset vaatimukset ovat eRapun omia tiivistelmiä vakiintuneesta
 * käytännöstä, eivät lainauksia mallipohjista. Kunnes Jukka on hyväksynyt
 * ne, PDF:ssä on luonnosmerkintä.
 */

export const RENOVATION_GUIDE_VERSION = 1;

/** Vakiotekstien hyväksyntä. `false` → luonnosmerkintä PDF:ssä (kuten RESCUE_PLAN_TEMPLATE_APPROVED). */
export const RENOVATION_GUIDE_TEMPLATE_APPROVED = false;

/** Asbestin käyttö rakennustuotteissa kiellettiin Suomessa 1994; sitä vanhemmissa rakennuksissa kartoitus ennen purkua. */
export const ASBESTOS_SURVEY_BEFORE_YEAR = 1994;

export interface GuideSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface GuideWorkType {
  key: string;
  title: string;
  intro: string;
  requirements: string[];
}

export const GUIDE_WORK_TYPES: readonly GuideWorkType[] = [
  {
    key: "markatilat",
    title: "Märkätilat (kylpyhuone, sauna, wc)",
    intro: "Märkätilan remontti on vesivahinkoriskin vuoksi tärkein valvottava muutostyö. Virheellinen vedeneristys voi vahingoittaa rakenteita ja naapurihuoneistoja.",
    requirements: [
      "Vedeneristyksen tekee henkilö, jolla on voimassa oleva vedeneristäjän henkilösertifikaatti. Vedeneristysjärjestelmän on oltava sertifioitu, ja sitä käytetään valmistajan ohjeen mukaan.",
      "Vedeneristyksestä laaditaan tarkastuspöytäkirja valokuvineen. Kopio toimitetaan isännöitsijälle ennen kuin työ ilmoitetaan valmiiksi.",
      "Lattiakaivo ja sen liitos vedeneristykseen tehdään valvojan ohjeen mukaan. Vanhan kaivon uusimisesta tai korjausratkaisusta sovitaan ennen työn aloittamista.",
      "Lattian kaadot tehdään kaivoa kohti niin, ettei vesi jää seisomaan.",
      "Valvoja tarkastaa työn vähintään purkutöiden jälkeen, vedeneristyksen valmistuttua ennen laatoitusta ja työn valmistuttua.",
      "Poistoilmaventtiiliä ei saa vaihtaa, siirtää eikä säätää.",
    ],
  },
  {
    key: "keittio",
    title: "Keittiö",
    intro: "Keittiöremontissa huomio kiinnittyy vesiliitoksiin, ilmanvaihtoon ja kantaviin rakenteisiin.",
    requirements: [
      "Astianpesukoneen ja muiden vesikalusteiden liitokset tekee ammattitaitoinen asentaja. Koneiden alle asennetaan vuotokaukalo tai vuotovahti ja liitoksiin sulkuventtiili.",
      "Tiskipöydän kaapin pohjalle asennetaan vesitiivis suoja.",
      "Omalla moottorilla varustettua liesituuletinta ei saa liittää yhtiön koneelliseen poistoilmanvaihtoon. Käytä liesikupua tai yhtiön hyväksymää ratkaisua.",
      "Kantavia seiniä ei saa purkaa eikä niihin saa tehdä aukkoja ilman rakennesuunnitelmaa ja yhtiön lupaa.",
    ],
  },
  {
    key: "sahko",
    title: "Sähkötyöt",
    intro: "Sähkötyöt kuuluvat sähköturvallisuuslain (1135/2016) piiriin.",
    requirements: [
      "Sähköasennuksia saa tehdä vain sähköurakoitsija, joka on tehnyt ilmoituksen Turvallisuus- ja kemikaalivirastolle (Tukes).",
      "Urakoitsija tekee asennuksille käyttöönottotarkastuksen ja antaa siitä pöytäkirjan. Kopio toimitetaan isännöitsijälle.",
      "Yhtiön pääkeskukseen, nousujohtoihin ja yleisten tilojen sähköihin ei saa tehdä muutoksia ilman yhtiön lupaa.",
      "Sähköinen lattialämmitys ja sen termostaatti asennetaan valmistajan ohjeen mukaan, ja asennus kirjataan käyttöönottotarkastukseen.",
    ],
  },
  {
    key: "vesi",
    title: "Vesi- ja viemäriliitokset",
    intro: "Käyttövesi- ja viemärijärjestelmä on yhtiön perusjärjestelmä, jonka toimivuus ei saa vaarantua.",
    requirements: [
      "Liitokset yhtiön nousulinjoihin ja viemäreihin tekee ammattitaitoinen putkiasentaja.",
      "Nousulinjoihin, runkoviemäreihin ja niiden sulkuventtiileihin ei saa tehdä muutoksia ilman yhtiön lupaa.",
      "Vesikatkot tilataan huollolta etukäteen. Osakas ei saa itse sulkea yhtiön venttiileitä.",
      "Vesimittarit, jos huoneistossa on sellaiset, jätetään paikalleen ja luettaviksi.",
    ],
  },
  {
    key: "lammitys",
    title: "Lämmitys",
    intro: "Lämmitysverkosto on yhtiön perusjärjestelmä, ja muutokset vaikuttavat myös muiden huoneistojen lämpötiloihin.",
    requirements: [
      "Lämmityspattereita ei saa poistaa, siirtää, vaihtaa eikä peittää kiinteästi ilman yhtiön lupaa.",
      "Patteriverkoston tyhjennys ja täyttö tilataan huollolta.",
      "Termostaattiventtiilien esisäätöjä ei saa muuttaa.",
    ],
  },
  {
    key: "ilmanvaihto",
    title: "Ilmanvaihto",
    intro: "Ilmanvaihto on yhteinen koko rakennukselle; yhden huoneiston muutos voi häiritä muita.",
    requirements: [
      "Poistoilmaventtiileitä ei saa vaihtaa, poistaa eikä säätää.",
      "Ilmanvaihtokanaviin ei saa liittää moottoroitua liesituuletinta, kuivausrumpua tai muuta laitetta.",
      "Korvausilmaventtiileitä ei saa tukkia eikä poistaa.",
      "Ilmalämpöpumpun ulkoyksikkö tai muu julkisivuun kiinnitettävä laite vaatii yhtiön luvan.",
    ],
  },
  {
    key: "lattiat",
    title: "Lattiat ja pintamateriaalit",
    intro: "Lattiamateriaalin vaihto voi heikentää askelääneneristystä ja siirtää äänet alakertaan.",
    requirements: [
      "Kun muovimatto tai kokolattiamatto vaihdetaan kovaan pintaan (parketti, laminaatti, laatta), käytetään askeläänieristettä. Ilmoita materiaali ja alusmateriaali muutostyöilmoituksessa.",
      "Lattian tasoitteiden ja vanhan päällysteen poisto voi vaatia haitta-ainekartoituksen (ks. purkutyöt).",
      "Pintamateriaalien vaihto kuivissa tiloissa ei yleensä vaadi ilmoitusta, jos se ei vaikuta rakenteisiin tai muihin huoneistoihin.",
    ],
  },
  {
    key: "rakenteet",
    title: "Väliseinät ja rakenteet",
    intro: "Rakenteet kuuluvat yhtiön kunnossapitovastuulle, ja niiden muuttaminen edellyttää aina ilmoitusta.",
    requirements: [
      "Kantaviin seiniin, välipohjiin ja ulkoseiniin ei saa tehdä aukkoja tai läpivientejä ilman rakennesuunnittelijan suunnitelmaa ja yhtiön lupaa.",
      "Kevyen väliseinän purkamisesta tai lisäämisestä liitetään ilmoitukseen pohjapiirros.",
      "Palo-osastoivien rakenteiden, kuten huoneiston ulko-oven ja porraskäytävän seinän, paloluokka ei saa heikentyä.",
      "Hormeihin ei saa tehdä muutoksia ilman yhtiön lupaa.",
    ],
  },
  {
    key: "ulkopuoli",
    title: "Ikkunat, parveke ja julkisivu",
    intro: "Rakennuksen ulkonäöstä ja julkisivusta päättää yhtiö.",
    requirements: [
      "Parvekelasitukset, markiisit, antennit ja muut julkisivuun näkyvät muutokset vaativat yhtiön luvan ja voivat vaatia viranomaisen luvan (AOYL 5:5).",
      "Julkisivuun, ikkunoiden karmeihin tai parvekkeen rakenteisiin ei saa porata ilman yhtiön lupaa.",
      "Ikkunoiden ja ulko-ovien vaihdosta ja korjaamisesta sovitaan aina isännöitsijän kanssa.",
    ],
  },
];

export const GUIDE_WORK_TYPE_KEYS = GUIDE_WORK_TYPES.map((w) => w.key);

const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max, "Teksti on liian pitkä.")).default("");

/** Yhtiökohtaiset asetukset (er_housing_companies.renovation_guide_settings, 0106). */
export const guideSettingsSchema = z.object({
  workTypes: z.array(z.string()).default(GUIDE_WORK_TYPE_KEYS).transform((keys) => GUIDE_WORK_TYPE_KEYS.filter((k) => keys.includes(k))),
  leadTime: text(200),
  workingHours: text(300),
  serviceContact: text(300),
  waterShutoff: text(600),
  waste: text(600),
  processingFee: text(400),
  extra: text(4000),
});
export type GuideSettings = z.infer<typeof guideSettingsSchema>;

export const DEFAULT_GUIDE_SETTINGS: GuideSettings = {
  workTypes: [...GUIDE_WORK_TYPE_KEYS],
  leadTime: "vähintään kolme viikkoa ennen suunniteltua aloitusta",
  workingHours: "Meluisia töitä saa tehdä arkisin klo 8–18. Viikonloppuisin ja arkipyhinä meluisia töitä ei tehdä.",
  serviceContact: "",
  waterShutoff: "Vesikatkot ja patteriverkoston tyhjennykset tilataan huollolta vähintään viikkoa etukäteen. Huolto tiedottaa katkosta porraskäytävässä.",
  waste: "Rakennusjätettä ei saa viedä taloyhtiön jäteastioihin. Osakas tai urakoitsija vie jätteet pois omalla kustannuksellaan.",
  processingFee: "",
  extra: "",
};

/** Tallennettu jsonb + oletukset tyhjille kentille. Tuntemattomat avaimet ohitetaan. */
export function resolveGuideSettings(stored: unknown): GuideSettings {
  const parsed = guideSettingsSchema.safeParse(stored && typeof stored === "object" ? stored : {});
  const s = parsed.success ? parsed.data : DEFAULT_GUIDE_SETTINGS;
  const hasWorkTypes = !!stored && typeof stored === "object" && Array.isArray((stored as { workTypes?: unknown }).workTypes);
  return {
    workTypes: hasWorkTypes ? s.workTypes : [...GUIDE_WORK_TYPE_KEYS],
    leadTime: s.leadTime || DEFAULT_GUIDE_SETTINGS.leadTime,
    workingHours: s.workingHours || DEFAULT_GUIDE_SETTINGS.workingHours,
    serviceContact: s.serviceContact,
    waterShutoff: s.waterShutoff || DEFAULT_GUIDE_SETTINGS.waterShutoff,
    waste: s.waste || DEFAULT_GUIDE_SETTINGS.waste,
    processingFee: s.processingFee,
    extra: s.extra,
  };
}

export interface GuideFacts {
  companyName: string;
  /** Vanhimman rakennuksen valmistumisvuosi; null = ei rekisterissä. */
  oldestBuildingYear: number | null;
  managerContact: string[];
}

export interface GuideContent {
  sections: GuideSection[];
  workTypes: GuideWorkType[];
  asbestos: GuideSection | null;
  legalBasis: string;
}

export const LEGAL_BASIS = "Asunto-osakeyhtiölaki 1599/2009 5 luku (muutostyöt), 4 luvun 7 § (ilmoituksen sisältö ja kulut), 7 luvun 27–28 § ja 24 luku (vahingonkorvaus)";

/** Ohjeen sisältö asetuksista ja yhtiön tiedoista. Puhdas funktio: PDF ja testit käyttävät samaa. */
export function buildGuideContent(settings: GuideSettings, facts: GuideFacts): GuideContent {
  const sections: GuideSection[] = [
    {
      title: "Mikä on muutostyö",
      paragraphs: [
        "Osakkaalla on oikeus tehdä omalla kustannuksellaan muutoksia huoneistossaan. Muutoksen on sovittava huoneiston käyttötarkoitukseen, ja työ on tehtävä hyvän rakennustavan mukaisesti (AOYL 5:1).",
        "Muutostyöstä on ilmoitettava etukäteen kirjallisesti isännöitsijälle tai hallitukselle, jos työ voi vaikuttaa yhtiön tai toisen osakkaan vastuulla oleviin rakenteisiin, järjestelmiin tai huoneistoihin taikka niiden käyttöön (AOYL 5:2).",
      ],
      bullets: [
        "Ilmoita aina: märkätilat, keittiön vesi- ja viemäriliitokset, sähkötyöt, ilmanvaihto, lämmitys, väliseinät ja rakenteet sekä lattiamateriaalin vaihto kovaan pintaan.",
        "Yhtiön hallinnassa oleviin tiloihin (esimerkiksi ullakko, kellari, piha) tehtävä muutos vaatii aina yhtiön etukäteen antaman suostumuksen (AOYL 5:8).",
        "Pelkkä maalaus, tapetointi ja kalusteiden vaihto kuivissa tiloissa ei yleensä vaadi ilmoitusta.",
      ],
    },
    {
      title: "Näin ilmoitat muutostyöstä",
      paragraphs: [
        `Tee ilmoitus eRapun asukasportaalissa kohdassa Muutostyöt ${settings.leadTime}. Ilmoitukseen kirjataan jokainen työ omana rivinään: mitä tehdään, kuka tekee ja milloin.`,
      ],
      bullets: [
        "Liitä mukaan suunnitelmat, pohjapiirros ja tarvittaessa materiaalitiedot.",
        "Kerro tekijän nimi, y-tunnus ja pätevyys (esimerkiksi vedeneristäjän sertifikaatti tai sähköurakoitsijan tiedot).",
        "Kuittaa, että olet lukenut tämän ohjeen.",
      ],
    },
    {
      title: "Käsittely ja päätös",
      paragraphs: [
        "Työtä ei saa aloittaa ennen kuin yhtiöllä on ollut kohtuullinen aika käsitellä ilmoitus, ellei yhtiö hyväksy aikaisempaa aloitusta (AOYL 5:4). Yhtiö käsittelee ilmoituksen viivytyksettä ja ilmoittaa päätöksestään portaalissa ja sähköpostilla.",
        "Yhtiö voi asettaa työlle ehtoja, jos työ voi vahingoittaa rakennusta tai aiheuttaa haittaa yhtiölle tai toiselle osakkaalle. Kohtuuttoman haitan aiheuttava työ voidaan kieltää. Jos työn aikana ilmenee uusia seikkoja, yhtiö voi asettaa lisäehtoja (AOYL 5:3).",
        "Jos muutos vaatii viranomaisen luvan tai yhtiöjärjestyksen muuttamista, osakas vastaa niiden kustannuksista (AOYL 5:5).",
      ],
    },
    {
      title: "Valvonta ja kustannukset",
      paragraphs: [
        "Yhtiöllä on oikeus valvoa, että työ tehdään rakennusta vahingoittamatta, hyvän rakennustavan mukaisesti ja asetettuja ehtoja noudattaen. Osakas vastaa tarpeellisista ja kohtuullisista valvontakuluista (AOYL 5:7). Valvoja ja valvonnan kustannusarvio kerrotaan päätöksessä.",
        ...(settings.processingFee ? [settings.processingFee] : []),
      ],
    },
    {
      title: "Työn aikana",
      paragraphs: [settings.workingHours],
      bullets: [
        "Tiedota naapureille ja porraskäytävän ilmoitustaululla työn ajankohdasta ja tekijän yhteystiedoista.",
        "Suojaa porraskäytävä ja hissi, ja siivoa yhteiset tilat päivittäin.",
        settings.waterShutoff,
        settings.waste,
      ],
    },
    {
      title: "Kun työ valmistuu",
      paragraphs: [
        "Ilmoita valmistumisesta isännöitsijälle ja toimita pyydetyt pöytäkirjat (esimerkiksi vedeneristyksen tarkastuspöytäkirja ja sähkötöiden käyttöönottotarkastus).",
        "Yhtiö säilyttää muutostyön tiedot, ja ne näkyvät isännöitsijäntodistuksessa (AOYL 7:27–28). Siksi hyväksytyt ja valmistuneet työt kirjataan huoneiston korjaushistoriaan.",
      ],
    },
    {
      title: "Vastuu",
      paragraphs: [
        "Osakas vastaa muutostyöstä yhtiölle ja muille osakkaille aiheutuvista vahingoista (AOYL 24 luku). Tarkista, että urakoitsijalla on vastuuvakuutus.",
        "Yhtiö korjaa sen vastuulle kuuluvan vian yhteydessä sisäosat vain yhtiön perustasoon. Perustasoa paremmat osakkaan tekemät ratkaisut jäävät osakkaan kustannettaviksi. Taloyhtiön vastuunjakotaulukko on nähtävissä asukasportaalissa.",
      ],
    },
  ];
  if (settings.extra) sections.push({ title: "Yhtiön lisäohjeet", paragraphs: settings.extra.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) });
  const contact = [...facts.managerContact, ...(settings.serviceContact ? [`Huolto: ${settings.serviceContact}`] : [])];
  if (contact.length) sections.push({ title: "Yhteystiedot", paragraphs: [], bullets: contact });

  const year = facts.oldestBuildingYear;
  const asbestos: GuideSection | null =
    year !== null && year >= ASBESTOS_SURVEY_BEFORE_YEAR
      ? null
      : {
          title: "Asbesti ja muut haitta-aineet",
          paragraphs: [
            year !== null
              ? `Yhtiön rakennus on valmistunut vuonna ${year}. Ennen vuotta ${ASBESTOS_SURVEY_BEFORE_YEAR} valmistuneiden rakennusten rakenteissa voi olla asbestia tai muita haitta-aineita, esimerkiksi laattojen kiinnityslaasteissa, tasoitteissa ja mattoliimoissa.`
              : `Rakennuksen valmistumisvuosi ei ole yhtiön rekisterissä. Ennen vuotta ${ASBESTOS_SURVEY_BEFORE_YEAR} valmistuneiden rakennusten rakenteissa voi olla asbestia tai muita haitta-aineita.`,
            "Ennen purkutöitä purettavista rakenteista on tehtävä asbesti- ja haitta-ainekartoitus. Asbestipurkutyön saa tehdä vain urakoitsija, jolla on siihen lupa. Kartoitusraportti liitetään muutostyöilmoitukseen.",
          ],
        };

  return {
    sections,
    workTypes: GUIDE_WORK_TYPES.filter((w) => settings.workTypes.includes(w.key)),
    asbestos,
    legalBasis: LEGAL_BASIS,
  };
}
