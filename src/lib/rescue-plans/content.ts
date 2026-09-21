import { z } from "zod";

/**
 * Taloyhtiön pelastussuunnitelman sisältö (pohjan versio 1).
 *
 * Rakenne: pelastuslaki 379/2011 15 § ja VNa 407/2011 2 § (pakolliset
 * sisältökohdat), jaottelu Jukan aiemmista suunnitelmista (riskiarvio
 * tapahtuma–seuraus–riskitaso ja ehkäisy) ja SPEKin asuinrakennusten
 * mallipohjasta (suunnitelman tiedot, väestönsuojelu, ylläpito, koulutus).
 * Lähteet ja tulkinnat: DECISIONS.md 2026-09-15 Pelastussuunnitelma.
 *
 * Vakiotekstit (vaaratilanteet ja toimintaohjeet) ovat eRapun omia
 * tiivistelmiä, eivät lainauksia mallipohjista. Jukka hyväksyi vakiotekstit
 * 21.9.2026.
 *
 * Kaikki kentät ovat merkkijonoja, jotta lomake ja jsonb-kenttä vastaavat
 * toisiaan suoraan; luvut ovat tekstiä ("noin 20").
 */

export const RESCUE_PLAN_TEMPLATE_VERSION = 1;

/** Vakiotekstien hyväksyntä. `false` → luonnosmerkintä PDF:ssä (kuten CERTIFICATE_TEMPLATE_APPROVED). */
export const RESCUE_PLAN_TEMPLATE_APPROVED = true;

/** Suunnitelman tarkistusväli. VNa 407/2011 ei määrää väliä; vuosittainen tarkistus on pelastuslaitosten ja SPEKin suositus. */
export const REVIEW_INTERVAL_MONTHS = 12;

export const LEGAL_BASIS = "Pelastuslaki 379/2011 14–15 § ja valtioneuvoston asetus pelastustoimesta 407/2011 1–2 §";

const text = (max: number) => z.string().max(max, "Teksti on liian pitkä.").default("");

export const RISK_LEVELS = [1, 2, 3, 4, 5] as const;
export const RISK_LEVEL_LABEL: Record<number, string> = { 1: "lievä", 2: "vähäinen", 3: "kohtalainen", 4: "merkittävä", 5: "sietämätön" };

const buildingSchema = z.object({
  label: text(40),
  type: text(80),
  completedYear: text(10),
  floors: text(10),
  material: text(120),
  heating: text(160),
  ventilation: text(160),
});
export type PlanBuilding = z.infer<typeof buildingSchema>;

const hazardSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  selected: z.boolean().default(true),
  title: text(120),
  consequence: text(600),
  level: z.number().int().min(1).max(5).default(2),
  prevention: text(1500),
  custom: z.boolean().default(false),
});
export type PlanHazard = z.infer<typeof hazardSchema>;

export const SHELTER_OPTIONS = ["none", "own", "shared", "unknown"] as const;
export type ShelterOption = (typeof SHELTER_OPTIONS)[number];
export const SHELTER_LABEL: Record<ShelterOption, string> = {
  none: "Yhtiöllä ei ole väestönsuojaa",
  own: "Yhtiön oma väestönsuoja",
  shared: "Yhteinen tai toisen kiinteistön väestönsuoja",
  unknown: "Ei selvitetty",
};

export const contentSchema = z.object({
  // 1 Suunnitelman tiedot
  preparedBy: text(300),
  preparationNote: text(1500),
  updateProcedure: text(1500),
  boardApprovedOn: text(10),

  // 2 Kohteen perustiedot
  companyName: text(200),
  address: text(300),
  propertyCodes: text(300),
  buildings: z.array(buildingSchema).max(30).default([]),
  apartments: text(40),
  residentsEstimate: text(40),
  commercialUnits: text(300),
  heating: text(500),
  fireplaces: text(500),
  commonSpaces: text(800),
  storages: text(800),
  parking: text(800),
  keySystem: text(500),
  hazardousMaterials: text(800),
  /** VNa 407/2011 2 § 1 mom.: tavanomaisesta poikkeava käyttö ja tilapäinen käyttötavan muutos. */
  unusualUse: text(1000),

  // 3 Vastuuhenkilöt ja yhteystiedot
  managerName: text(160),
  managerPhone: text(60),
  managerEmail: text(160),
  chairName: text(160),
  chairPhone: text(60),
  safetyPersons: text(1000),
  maintenanceName: text(160),
  maintenancePhone: text(60),
  maintenanceEmergencyPhone: text(60),
  otherContacts: text(1500),

  // 4 Vaaratilanteet ja riskiarvio
  hazards: z.array(hazardSchema).max(40).default([]),
  /** PL 15 § 2 mom. 1 k.: selostus riskien arvioinnin johtopäätelmistä. Tyhjänä PDF kokoaa sen riskitasoista. */
  riskConclusions: text(1500),

  // 5 Turvallisuusjärjestelyt ja ennaltaehkäisy
  smokeAlarms: text(1000),
  extinguishers: text(1000),
  escapeRoutes: text(1000),
  assemblyPoint: text(300),
  assemblyPointAlt: text(300),
  rescueRoad: text(800),
  shutoffWater: text(300),
  shutoffElectricity: text(300),
  shutoffVentilation: text(300),
  shutoffHeating: text(300),
  storageRules: text(1000),
  hotWork: text(800),
  inspections: text(1500),

  // 6 Toiminta onnettomuus- ja vaaratilanteissa
  extraInstructions: text(2000),

  // 7 Väestönsuojelu
  shelter: z.enum(SHELTER_OPTIONS).default("unknown"),
  shelterLocation: text(300),
  shelterCapacity: text(40),
  shelterResponsible: text(300),
  shelterNotes: text(1500),

  // 8 Asukkaiden tiedottaminen ja koulutus
  communication: text(1500),
  training: text(1500),

  // 9 Liitteet
  attachmentDocumentIds: z.array(z.string().uuid()).max(6).default([]),
  attachmentNotes: text(800),
});

export type RescuePlanContent = z.infer<typeof contentSchema>;

/** Tallennettu sisältö luetaan sietävästi: vanhan pohjan puuttuvat kentät saavat oletuksen. */
export function parseContent(value: unknown): RescuePlanContent {
  const base = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const parsed = contentSchema.safeParse(base);
  if (parsed.success) return parsed.data;
  // Rikkinäinen kenttä ei saa kaataa sivua: pudotetaan kentät, jotka eivät kelpaa.
  const clean: Record<string, unknown> = {};
  const shape = contentSchema.shape as Record<string, z.ZodTypeAny>;
  for (const [key, schema] of Object.entries(shape)) {
    const r = schema.safeParse((base as Record<string, unknown>)[key]);
    if (r.success) clean[key] = r.data;
  }
  return contentSchema.parse(clean);
}

export function emptyContent(): RescuePlanContent {
  return contentSchema.parse({});
}

// ---------------------------------------------------------------------------
// Vaaratilanteet (valintalista vakioteksteillä)
// ---------------------------------------------------------------------------

export interface HazardTemplate {
  key: string;
  title: string;
  consequence: string;
  level: number;
  prevention: string;
}

export const HAZARD_TEMPLATES: HazardTemplate[] = [
  {
    key: "apartment_fire",
    title: "Tulipalo asunnossa",
    consequence: "Savu ja palo leviävät asunnosta porrashuoneeseen, ullakolle tai naapuriasuntoon. Henkilö- ja omaisuusvahinkoja.",
    level: 2,
    prevention:
      "Taloyhtiö varustaa asunnot palovaroittimilla ja pitää ne toimintakunnossa. Asukas testaa varoittimen (suositus kerran kuukaudessa) ja ilmoittaa viasta heti isännöitsijälle tai huoltoon. Liettä, kynttilöitä ja kodinkoneita ei jätetä valvomatta, ja sähkölaitteet ja johdot pidetään ehjinä. Sammutuspeite keittiöön on suositeltava.",
  },
  {
    key: "sauna_fireplace",
    title: "Sauna, tulisija tai lämmityslaite",
    consequence: "Kiukaan tai tulisijan ympäristö syttyy, hormipalo tai häkävaara.",
    level: 2,
    prevention:
      "Kiukaan päälle tai lähelle ei jätetä tavaraa eikä kiuasta käytetä kuivaushuoneena. Tulisijat ja hormit nuohotaan säännöllisesti, ja pellit suljetaan vasta, kun hiillos on sammunut. Lämmityslaitteet huolletaan valmistajan ohjeiden mukaan.",
  },
  {
    key: "water_damage",
    title: "Vesivahinko",
    consequence: "Rakenteet kastuvat ja vaurioituvat, homeen ja sähkövaaran riski, korjaukset ja asumisen haitta.",
    level: 3,
    prevention:
      "Pesu- ja astianpesukoneiden hanat suljetaan käytön jälkeen, ja koneiden ja lämminvesivaraajien alla on kosteushälytin tai vuotoallas. Vuodoista ja kosteusjäljistä ilmoitetaan heti huoltoon. Pääsulkujen sijainti on tiedossa.",
  },
  {
    key: "power_outage",
    title: "Sähkökatko",
    consequence: "Lämmitys, ilmanvaihto, valaistus ja viestiyhteydet katkeavat. Pitkässä katkossa asunnot kylmenevät ja jäätymisvaara kasvaa.",
    level: 2,
    prevention:
      "Asukkailla on kotivara (vesi, ruoka, lääkkeet vähintään muutamaksi vuorokaudeksi), taskulamppu ja paristokäyttöinen radio. Kynttilöiden ja tilapäisten lämmittimien käytössä noudatetaan erityistä varovaisuutta.",
  },
  {
    key: "storm",
    title: "Myrsky, rankkasade tai lumikuorma",
    consequence: "Kaatuneet puut, katto- ja räystäsvauriot, kattolumen putoaminen, hulevesien tulviminen rakenteisiin.",
    level: 2,
    prevention:
      "Pihapuiden kunto tarkistetaan, pihan irtotavarat kiinnitetään tai viedään sisään ennen myrskyä, rännit ja sadevesikaivot pidetään puhtaina, ja katon lumikuormaa seurataan.",
  },
  {
    key: "chemicals",
    title: "Vaaralliset aineet ja kemikaalit",
    consequence: "Palon leviäminen, myrkytys tai ympäristövahinko.",
    level: 1,
    prevention:
      "Asunnossa säilytetään enintään 25 litraa syttyviä nesteitä ja 25 kg nestekaasua. Ullakolle, kellariin, porrashuoneisiin ja teknisiin tiloihin ei varastoida syttyviä nesteitä eikä kaasupulloja. Vaaralliset jätteet viedään keräykseen.",
  },
  {
    key: "waste_shelter",
    title: "Jätekatos ja pihavarastot",
    consequence: "Tuhopoltto tai palo jätekatoksessa, leviäminen rakennukseen tai autoihin.",
    level: 2,
    prevention:
      "Jätekatos ja jäteastiat ovat riittävän etäällä rakennuksesta (pelastuslaitosten ohjeen mukaan katoksen tyypistä riippuen 4–8 metriä), pihavarastot pidetään lukittuina ja siisteinä, ja piha-alue on valaistu. Ylimääräinen tavara viedään pois.",
  },
  {
    key: "parking_charging",
    title: "Autopaikat, lämmitystolpat ja akkujen lataus",
    consequence: "Ajoneuvopalo, lämmitys- tai latausjohdon ylikuumeneminen, akkupalo.",
    level: 2,
    prevention:
      "Sähköautoa ladataan vain latauskäyttöön tarkoitetulla laitteella ja pistorasialla, ei jatkojohdolla. Sähköpotkulautoja ja -pyöriä ei ladata porrashuoneissa eikä yhteisissä varastoissa. Lämmitysjohdot pidetään ehjinä ja irrotetaan käytön jälkeen. Autopaikkojen sähköasennukset teettää vain sähköalan ammattilainen.",
  },
  {
    key: "vandalism",
    title: "Ilkivalta, tuhotyö tai murto",
    consequence: "Tuhopoltto, vahingot varastoissa tai sähkökeskuksessa, omaisuuden katoaminen.",
    level: 2,
    prevention:
      "Ulko-ovet, varastot ja tekniset tilat pidetään lukittuina, avaimista pidetään kirjaa, ja ulkovalaistus on kunnossa. Asukkaat ilmoittavat epäilyttävästä toiminnasta poliisille (112) ja vaurioista isännöitsijälle.",
  },
  {
    key: "medical",
    title: "Sairauskohtaus tai tapaturma",
    consequence: "Välittömän avun puute. Haja-asutusalueella ensihoidon saapuminen voi kestää.",
    level: 2,
    prevention:
      "Asukkaita kannustetaan ensiapukoulutukseen ja naapureista huolehtimiseen. Kulkureitit hiekoitetaan ja valaistaan, ja osoite- ja porrasmerkinnät pidetään näkyvinä, jotta ensihoito löytää perille.",
  },
  {
    key: "external_hazard",
    title: "Ympäristön vaaratilanne (kaasu, kemikaali tai säteily)",
    consequence: "Liikenne- tai teollisuusonnettomuudesta leviävä kaasu, savu tai säteily.",
    level: 1,
    prevention:
      "Asukkaat tuntevat yleisen vaaramerkin ja sisälle suojautumisen ohjeen. Ilmanvaihdon pysäytystapa on kerrottu tässä suunnitelmassa.",
  },
];

export function hazardsFromTemplates(): PlanHazard[] {
  return HAZARD_TEMPLATES.map((h) => ({ ...h, selected: true, custom: false }));
}

// ---------------------------------------------------------------------------
// Toimintaohjeet (vakiotekstit PDF:ssä)
// ---------------------------------------------------------------------------

export interface Instruction {
  key: string;
  title: string;
  steps: string[];
}

export const EMERGENCY_INSTRUCTIONS: Instruction[] = [
  {
    key: "emergency_call",
    title: "Hätäilmoitus",
    steps: [
      "Soita hätänumeroon 112. Soita itse, jos voit, ja käytä tarvittaessa 112 Suomi -sovellusta.",
      "Kerro, mitä on tapahtunut, ja anna tarkka osoite ja kunta.",
      "Vastaa kysymyksiin ja toimi saamiesi ohjeiden mukaan. Lopeta puhelu vasta, kun saat siihen luvan.",
      "Järjestä pelastajille opastus ja esteetön pääsy kohteeseen.",
    ],
  },
  {
    key: "fire",
    title: "Tulipalo",
    steps: [
      "Pelasta välittömässä vaarassa olevat ja varoita muita.",
      "Sammuta palo, jos se on turvallista (sammutuspeite, alkusammutin).",
      "Rajoita paloa sulkemalla ovet ja ikkunat.",
      "Tee hätäilmoitus numeroon 112.",
      "Poistu ulos ja mene kokoontumispaikalle. Älä käytä hissiä.",
      "Opasta pelastuslaitos paikalle ja kerro, onko rakennukseen jäänyt ihmisiä.",
    ],
  },
  {
    key: "fire_blocked",
    title: "Kun porrashuone tai poistumistie on täynnä savua",
    steps: [
      "Pysy asunnossa, sulje ovi ja tiivistä raot märillä pyyhkeillä.",
      "Soita 112 ja kerro, missä olet.",
      "Mene ikkunaan tai parvekkeelle ja näytä pelastajille, että olet sisällä.",
    ],
  },
  {
    key: "water",
    title: "Vesivahinko",
    steps: [
      "Sulje vuotavan laitteen hana tai tarvittaessa asunnon tai rakennuksen vesisulku.",
      "Katkaise sähkö kastuneista laitteista, jos se on turvallista.",
      "Ilmoita heti kiinteistöhuoltoon (päivystys) ja isännöitsijälle ja varoita naapureita, joihin vesi voi valua.",
      "Kuivaa ja siirrä irtaimisto pois vedestä ja ota valokuvia vahingosta.",
    ],
  },
  {
    key: "power",
    title: "Sähkökatko",
    steps: [
      "Tarkista asunnon sulakkeet ja vikavirtasuojakytkin ja selvitä, onko naapureillakin katko.",
      "Tarkista sähköyhtiön häiriötiedote tai ilmoita viasta sähköyhtiölle.",
      "Sammuta liesi ja lämmittimet, jotta ne eivät käynnisty valvomatta sähkön palatessa.",
      "Pidä pakastin ja jääkaappi kiinni. Varo kynttilöitä ja tilapäisiä lämmittimiä.",
      "Huolehdi naapureista, jotka tarvitsevat apua tai sähköllä toimivia apuvälineitä.",
    ],
  },
  {
    key: "first_aid",
    title: "Sairauskohtaus tai tapaturma",
    steps: [
      "Selvitä, mitä on tapahtunut, ja tarkista hengitys ja tajunta.",
      "Tee hätäilmoitus 112 ja anna ensiapua ohjeiden mukaan.",
      "Älä jätä autettavaa yksin. Opasta ensihoito paikalle.",
    ],
  },
  {
    key: "shelter_in",
    title: "Yleinen vaaramerkki ja sisälle suojautuminen",
    steps: [
      "Yleinen vaaramerkki on minuutin nouseva ja laskeva äänimerkki tai viranomaisen kuulutus. Vaara ohi -merkki on tasainen minuutin äänimerkki. Koeääni kuukauden ensimmäisenä arkimaanantaina klo 12.",
      "Mene sisälle ja pysy sisällä. Sulje ovet, ikkunat, tuuletusventtiilit ja ilmanvaihto.",
      "Kuuntele radiota (Yle) ja seuraa viranomaisten tiedotteita. Vältä puhelimen käyttöä, ettei verkko ruuhkaudu.",
      "Poistu alueelta vain viranomaisen kehotuksesta.",
    ],
  },
  {
    key: "evacuation",
    title: "Poistuminen ja kokoontumispaikka",
    steps: [
      "Poistu rakennuksesta lähintä turvallista reittiä ja auta muita poistumaan.",
      "Kokoonnu sovitulle kokoontumispaikalle ja selvitä, puuttuuko joku.",
      "Kerro pelastajille puuttuvista henkilöistä. Älä palaa rakennukseen ilman lupaa.",
    ],
  },
];

/** Poikkeusolojen vakioteksti väestönsuojan mukaan. PL 76 §: suoja käyttökuntoon 72 tunnissa. */
export function civilDefenceText(shelter: ShelterOption): string[] {
  const common =
    "Poikkeusoloissa viranomaiset ohjeistavat väestöä radiossa, televisiossa ja verkossa. Asukkaat varautuvat omatoimisesti kotivaralla ja tuntevat sisälle suojautumisen ohjeen.";
  if (shelter === "own" || shelter === "shared") {
    return [
      common,
      "Väestönsuoja varusteineen pidetään sellaisessa kunnossa, että se voidaan ottaa käyttöön 72 tunnissa viranomaisen määräyksestä (pelastuslaki 76 §). Arkikäytössä olevan suojan tyhjentäminen ja käyttökuntoon laittaminen on suunniteltu etukäteen.",
      "Suojan laitteet ja varusteet tarkistetaan omatoimisesti vuosittain, ja toimintakunto tarkastetaan määräajoin pelastuslaitosten ohjeiden mukaan.",
    ];
  }
  if (shelter === "none") {
    return [
      common,
      "Yhtiöllä ei ole väestönsuojaa. Vaaratilanteessa suojaudutaan sisälle omaan asuntoon. Jos väestöä on suojattava pidempään, viranomainen ohjaa asukkaat yleiseen väestönsuojaan tai muualle.",
    ];
  }
  return [common, "Väestönsuojajärjestelyt on selvitettävä ja kirjattava suunnitelman seuraavassa päivityksessä."];
}

// ---------------------------------------------------------------------------
// Osiot (PDF:n otsikot ja numerointi)
// ---------------------------------------------------------------------------

export const PLAN_SECTIONS = [
  { key: "plan", title: "Suunnitelman tiedot" },
  { key: "property", title: "Kohteen perustiedot" },
  { key: "contacts", title: "Vastuuhenkilöt ja yhteystiedot" },
  { key: "hazards", title: "Vaaratilanteet ja riskiarvio" },
  { key: "safety", title: "Turvallisuusjärjestelyt ja ennaltaehkäisy" },
  { key: "instructions", title: "Toiminta onnettomuus- ja vaaratilanteissa" },
  { key: "civil_defence", title: "Poikkeusolot ja väestönsuojelu" },
  { key: "communication", title: "Asukkaiden tiedottaminen ja koulutus" },
  { key: "maintenance", title: "Suunnitelman ylläpito" },
  { key: "attachments", title: "Liitteet" },
] as const;

export type PlanSectionKey = (typeof PLAN_SECTIONS)[number]["key"];

export function sectionNumber(key: PlanSectionKey): number {
  return PLAN_SECTIONS.findIndex((s) => s.key === key) + 1;
}
