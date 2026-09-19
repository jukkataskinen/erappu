import { HEATING_TYPE_LABEL, type HeatingType } from "@/lib/consumption/heating";
import { addMonths, type IsoDate } from "@/lib/tasks/dates";
import { emptyContent, hazardsFromTemplates, REVIEW_INTERVAL_MONTHS, type PlanBuilding, type RescuePlanContent } from "./content";
import { safetyPlanFields } from "@/lib/registry/safety";
import type { RegistryBuilding, RegistrySnapshot } from "./registry";

/**
 * Pelastussuunnitelman esitäyttö rekisteristä. Puhdas funktio: sama
 * rekisterin tila tuottaa saman sisällön.
 *
 * Rekisteristä tulevat kentät (REGISTRY_FIELDS) voidaan päivittää
 * luonnokseen uudelleen ("Päivitä rekisteristä"), jolloin käsin kirjoitetut
 * turvallisuusjärjestelyt, riskiarvio ja ohjeet säilyvät.
 */

export const REGISTRY_FIELDS = [
  "companyName", "address", "propertyCodes", "buildings", "apartments", "residentsEstimate", "commercialUnits", "heating",
  "commonSpaces", "parking", "managerName", "managerPhone", "managerEmail", "chairName", "chairPhone",
  "maintenanceName", "maintenancePhone", "maintenanceEmergencyPhone",
] as const satisfies readonly (keyof RescuePlanContent)[];

const join = (parts: (string | null | undefined)[], sep = ", ") => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);
const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

export function heatingText(b: Pick<RegistryBuilding, "heating" | "heating_type" | "heat_distribution">): string {
  const main = b.heating_type ? HEATING_TYPE_LABEL[b.heating_type as HeatingType] ?? b.heating : b.heating;
  return join([main, b.heat_distribution]);
}

function planBuilding(b: RegistryBuilding): PlanBuilding {
  return {
    label: b.label ?? "",
    type: b.building_type ?? "",
    completedYear: b.completed_year ? String(b.completed_year) : "",
    floors: b.floors ? String(b.floors) : "",
    material: join([b.construction_material, join([b.roof_type, b.roof_material], " / ")]),
    heating: heatingText(b),
    ventilation: b.ventilation ?? "",
  };
}

/** Asukasmäärä: rekisterin asukkaat, muuten karkea arvio huoneistoista (2 hlö/asunto). */
export function residentsEstimate(snapshot: Pick<RegistrySnapshot, "residents" | "units">): string {
  if (snapshot.residents > 0) return `noin ${snapshot.residents}`;
  if (snapshot.units.apartments > 0) return `noin ${snapshot.units.apartments * 2} (arvio)`;
  return "";
}

export function registryFields(s: RegistrySnapshot): Pick<RescuePlanContent, (typeof REGISTRY_FIELDS)[number]> {
  const provider = s.maintenanceProviders[0] ?? null;
  const floors = uniq(s.buildings.map((b) => (b.floors ? String(b.floors) : "")));
  const staircases = s.buildings.reduce((n, b) => n + (b.staircases ?? 0), 0);
  const elevators = s.buildings.reduce((n, b) => n + (b.elevators ?? 0), 0);
  const heating = uniq(s.buildings.map(heatingText));
  const spaces = uniq(s.buildings.flatMap((b) => b.common_spaces));
  const parkingParts = [
    s.parkingBuilt !== null ? `autopaikkoja ${s.parkingBuilt}` : null,
    s.company.parking_hall_spaces ? `hallipaikkoja ${s.company.parking_hall_spaces}` : null,
    s.units.parking > 0 ? `osakeryhminä ${s.units.parking}` : null,
  ];
  const apartmentText = s.units.apartments > 0
    ? join([
        `${s.units.apartments} asuinhuoneistoa`,
        floors.length === 1 ? `${floors[0]}-kerroksinen` : floors.length > 1 ? `kerroksia ${floors.join("/")}` : null,
        staircases ? `porrashuoneita ${staircases}` : null,
        elevators ? `hissejä ${elevators}` : null,
      ])
    : "";

  return {
    companyName: s.company.name,
    address: join([s.company.street_address, join([s.company.postal_code, s.company.city], " ")]),
    propertyCodes: s.propertyCodes.join(", "),
    buildings: s.buildings.map(planBuilding),
    apartments: apartmentText,
    residentsEstimate: residentsEstimate(s),
    commercialUnits: s.units.commercial > 0 ? `${s.units.commercial} liike- tai toimitilaa` : "Ei liiketiloja",
    heating: heating.join("; "),
    commonSpaces: spaces.join(", "),
    parking: join(parkingParts),
    managerName: s.manager?.name ?? "",
    managerPhone: s.manager?.phone ?? s.organization.phone ?? "",
    managerEmail: s.manager?.email ?? s.organization.email ?? "",
    chairName: s.chair?.name ?? "",
    chairPhone: s.chair?.phone ?? "",
    maintenanceName: provider?.name ?? s.company.property_maintenance ?? "",
    maintenancePhone: provider?.phone ?? "",
    maintenanceEmergencyPhone: provider?.emergency_phone ?? "",
  };
}

export function nextReviewDate(preparedOn: IsoDate): IsoDate {
  return addMonths(preparedOn, REVIEW_INTERVAL_MONTHS);
}

/** Ensimmäisen luonnoksen sisältö: rekisterin tiedot ja vakiotekstien oletukset. */
export function buildPrefill(s: RegistrySnapshot): RescuePlanContent {
  const hasFireplaceHint = s.buildings.some((b) => /puu|takka|tulisija|pelletti/i.test(`${b.heating ?? ""} ${b.heating_type ?? ""}`));
  const hazards = hazardsFromTemplates().map((h) => {
    // Valinnat, jotka rekisteri osaa perustella: ilman autopaikkoja ja liiketiloja kohta jää pois, muut ovat oletuksena mukana.
    if (h.key === "parking_charging" && s.parkingBuilt === null && s.units.parking === 0 && !s.company.parking_other_spaces && !s.company.parking_hall_spaces) {
      return { ...h, selected: false };
    }
    return h;
  });
  return {
    ...emptyContent(),
    ...registryFields(s),
    preparedBy: join([s.manager?.name ? `Isännöitsijä ${s.manager.name}` : "Isännöitsijä", "yhdessä hallituksen kanssa"], " "),
    preparationNote:
      "Suunnitelma on laadittu eRapussa taloyhtiön rekisteritietojen pohjalta. Riskit on arvioitu kiinteistön ulkoalueiden, sisätilojen ja käytön perusteella.",
    updateProcedure:
      "Hallitus tarkistaa suunnitelman vähintään kerran vuodessa ja aina, kun rakennuksessa, sen käytössä tai vastuuhenkilöissä tapahtuu olennaisia muutoksia. Isännöitsijä päivittää suunnitelman ja tiedottaa muutoksista asukkaille.",
    fireplaces: hasFireplaceHint ? "Rakennuksissa on tulisijoja. Tarkista määrä ja nuohousvastuu." : "",
    storages: "",
    keySystem: "",
    hazardousMaterials: "Yhtiössä ei säilytetä vaarallisia aineita tavanomaisia kotitalousmääriä enempää.",
    unusualUse: "",
    safetyPersons: "",
    otherContacts: "",
    hazards,
    smokeAlarms:
      "Taloyhtiö hankkii asuntoihin palovaroittimet ja pitää ne toimintakunnossa 1.1.2026 alkaen (pelastuslaki 17 §). Varoittimia on vähintään yksi jokaisen kerroksen tai tason alkavaa 60 neliömetriä kohti. Asukas testaa varoittimen säännöllisesti ja ilmoittaa viasta viipymättä isännöitsijälle.",
    extinguishers: "",
    escapeRoutes: "Poistumistiet ovat asuntojen ulko-ovet ja tarvittaessa ikkunat. Uloskäytävät ja niille johtavat reitit pidetään esteettöminä, eikä niihin säilytetä tavaraa.",
    assemblyPoint: "",
    assemblyPointAlt: "",
    rescueRoad: "Pelastustie pidetään ajokelpoisena, aurattuna ja esteettömänä. Pelastustielle ei pysäköidä.",
    shutoffWater: "",
    shutoffElectricity: "",
    shutoffVentilation: "",
    shutoffHeating: "",
    storageRules:
      "Ullakolla, kellarissa, porrashuoneissa ja teknisissä tiloissa ei säilytetä helposti syttyvää tavaraa. Rakennuksen seinustalle ei kasata palavaa materiaalia.",
    hotWork: "Tulitöistä (esim. hitsaus, kattotyöt) sovitaan etukäteen isännöitsijän kanssa. Tulitöiden tekijällä on oltava voimassa oleva tulityökortti ja tulityölupa.",
    inspections:
      "Ilmanvaihtokanavat puhdistetaan noin 10 vuoden välein, tulisijat ja hormit nuohotaan vuosittain, käsisammuttimet tarkastetaan 2 vuoden välein ja palovaroittimet vaihdetaan viimeistään 10 vuoden iässä.",
    shelter: "unknown",
    communication:
      "Suunnitelma julkaistaan asukasportaalissa kaikille asukkaille, ja uudet asukkaat saavat sen muuttaessaan. Tiivistelmä toimintaohjeista ja kokoontumispaikasta on yhteisellä ilmoitustaululla. Muutoksista tiedotetaan portaalissa tai tiedotteella.",
    training:
      "Asukkaita kannustetaan omatoimiseen turvallisuuskoulutukseen (esim. SPEKin ja pelastuslaitoksen aineistot, ensiapukurssit). Hallitus ja isännöitsijä käyvät suunnitelman läpi vuosittain.",
    ...safetyPlanFields(s.safety ?? null),
  };
}

/** "Päivitä rekisteristä": vain rekisterikentät korvataan (turvallisuustiedot vain täytetyiltä osin), muu sisältö säilyy. */
export function refreshFromRegistry(content: RescuePlanContent, s: RegistrySnapshot): RescuePlanContent {
  return { ...content, ...registryFields(s), ...safetyPlanFields(s.safety ?? null) };
}
