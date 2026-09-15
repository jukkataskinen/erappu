import type { IconName } from "@/components/NavIcon";
import type { OrgRole } from "@/lib/auth/current-user";

/**
 * Taloyhtiön moduulit. Yhtiön etusivu näyttää nämä kortteina ryhmittäin, ja
 * moduulisivun murupolku ottaa nimen tästä. Moduulit omistavat omat sivunsa
 * polun /taloyhtiot/[id]/<path> alla; tämä lista on ainoa yhteinen kohta.
 */
export type CompanyModuleGroup = "rekisteri" | "arki" | "hallinto";

export const COMPANY_MODULE_GROUPS: { key: CompanyModuleGroup; label: string }[] = [
  { key: "rekisteri", label: "Rekisteri" },
  { key: "arki", label: "Arki" },
  { key: "hallinto", label: "Talous ja hallinto" },
];

export interface CompanyModule {
  key: string;
  label: string;
  path: string;
  icon: IconName;
  group: CompanyModuleGroup;
  /** Näytetään, kun tilariville ei ole dataa. */
  description: string;
  roles?: OrgRole[];
}

export const COMPANY_MODULES = [
  { key: "perustiedot", label: "Perustiedot", path: "/perustiedot", icon: "info", group: "rekisteri", description: "Yhtiön tiedot, perusdokumentit ja nostot" },
  { key: "huoneistot", label: "Huoneistot", path: "/huoneistot", icon: "door", group: "rekisteri", description: "Osakeryhmät, osakevälit ja pinta-alat" },
  { key: "osakkaat", label: "Osakkaat", path: "/osakkaat", icon: "users", group: "rekisteri", description: "Omistajat ja asukkaat" },
  { key: "hallitus", label: "Hallitus", path: "/hallitus", icon: "award", group: "rekisteri", description: "Hallituksen jäsenet ja tilintarkastus" },
  { key: "kiinteisto", label: "Kiinteistö", path: "/kiinteisto", icon: "map", group: "rekisteri", description: "Tontti ja rakennukset" },
  { key: "htj", label: "HTJ", path: "/htj", icon: "registry", group: "rekisteri", description: "Osakeluettelo ja HTJ2-ilmoitukset", roles: ["owner", "manager", "accountant", "assistant"] },
  { key: "huolto", label: "Huoltopyynnöt", path: "/huolto", icon: "wrench", group: "arki", description: "Vikailmoitukset ja QR-lomake" },
  { key: "korjaukset", label: "Korjaukset", path: "/korjaukset", icon: "hammer", group: "arki", description: "Kunnossapito, muutostyöt ja KPTS" },
  { key: "tiedotteet", label: "Tiedotteet", path: "/tiedotteet", icon: "megaphone", group: "arki", description: "Tiedotteet osakkaille ja asukkaille" },
  { key: "varaukset", label: "Varaukset", path: "/varaukset", icon: "key", group: "arki", description: "Saunat, pesutuvat ja kerhohuoneet" },
  { key: "vuosikello", label: "Vuosikello", path: "/vuosikello", icon: "list", group: "arki", description: "Määräajat ja toistuvat tehtävät" },
  { key: "kulutus", label: "Kulutus", path: "/kulutus", icon: "bolt", group: "arki", description: "Sähkö, vesi ja lämmitys" },
  { key: "talous", label: "Talous", path: "/talous", icon: "coins", group: "hallinto", description: "Vastikkeet, laskutus ja lainat" },
  { key: "kokoukset", label: "Kokoukset", path: "/kokoukset", icon: "calendar", group: "hallinto", description: "Yhtiökokoukset ja hallituksen kokoukset" },
  { key: "dokumentit", label: "Dokumentit", path: "/dokumentit", icon: "folder", group: "hallinto", description: "Yhtiön asiakirjat" },
  { key: "sopimukset", label: "Sopimukset", path: "/sopimukset", icon: "pen", group: "hallinto", description: "Sopimukset ja irtisanomisajat" },
  { key: "todistukset", label: "Todistukset", path: "/todistukset", icon: "stamp", group: "hallinto", description: "Isännöitsijäntodistukset", roles: ["owner", "manager", "assistant"] },
] as const satisfies readonly CompanyModule[];

export type CompanyModuleKey = (typeof COMPANY_MODULES)[number]["key"];

export function companyModuleHref(companyId: string, key: CompanyModuleKey): string {
  const m = COMPANY_MODULES.find((x) => x.key === key)!;
  return `/taloyhtiot/${companyId}${m.path}`;
}

export function companyModulesFor(role: OrgRole): CompanyModule[] {
  return COMPANY_MODULES.filter((m: CompanyModule) => !m.roles || m.roles.includes(role));
}
