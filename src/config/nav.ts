import type { OrgRole } from "@/lib/auth/current-user";

/**
 * Henkilökunnan päänavigaatio. Jokainen moduuli omistaa oman polkunsa;
 * tämä lista on ainoa paikka, jossa ne luetellaan yhdessä.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "building" | "wrench" | "registry" | "coins" | "calendar" | "megaphone" | "folder" | "list" | "gear" | "users";
  roles?: OrgRole[];
}

export const STAFF_NAV: NavItem[] = [
  { href: "/tyopoyta", label: "Työpöytä", icon: "home" },
  { href: "/taloyhtiot", label: "Taloyhtiöt", icon: "building" },
  { href: "/huoltopyynnot", label: "Huoltopyynnöt", icon: "wrench" },
  { href: "/htj", label: "HTJ", icon: "registry", roles: ["owner", "manager", "accountant", "assistant"] },
  { href: "/talous", label: "Talous", icon: "coins" },
  { href: "/kokoukset", label: "Kokoukset", icon: "calendar" },
  { href: "/tiedotteet", label: "Tiedotteet", icon: "megaphone" },
  { href: "/dokumentit", label: "Dokumentit", icon: "folder" },
  { href: "/vuosikello", label: "Vuosikello", icon: "list" },
  { href: "/varaukset", label: "Varaukset", icon: "calendar" },
  { href: "/sopimukset", label: "Sopimukset", icon: "registry" },
  { href: "/kulutus", label: "Kulutus", icon: "coins" },
  { href: "/todistukset", label: "Todistukset", icon: "folder", roles: ["owner", "manager", "assistant"] },
  { href: "/palveluntuottajat", label: "Palveluntuottajat", icon: "users" },
  { href: "/asetukset", label: "Asetukset", icon: "gear", roles: ["owner", "manager"] },
];

/** Portaalin koko valikko (työpöytäleveys ja "Oma"-sivun linkit). */
export const PORTAL_NAV = [
  { href: "/portaali", label: "Etusivu" },
  { href: "/portaali/huoltopyynnot", label: "Huoltopyynnöt" },
  { href: "/portaali/tiedotteet", label: "Tiedotteet" },
  { href: "/portaali/dokumentit", label: "Dokumentit" },
  { href: "/portaali/varaukset", label: "Varaukset" },
  { href: "/portaali/kokoukset", label: "Kokoukset" },
  { href: "/portaali/talous", label: "Talous" },
  { href: "/portaali/muutostyot", label: "Muutostyöt" },
  { href: "/portaali/oma", label: "Oma" },
];

/** Puhelimen alapalkki: viisi yleisintä, loput "Oma"-sivun kautta. */
export const PORTAL_TABBAR = [
  { href: "/portaali", label: "Etusivu" },
  { href: "/portaali/huoltopyynnot", label: "Huolto" },
  { href: "/portaali/tiedotteet", label: "Tiedotteet" },
  { href: "/portaali/varaukset", label: "Varaukset" },
  { href: "/portaali/oma", label: "Oma" },
];
