import type { IconName } from "@/components/NavIcon";
import type { OrgRole } from "@/lib/auth/current-user";

/**
 * Henkilökunnan päänavigaatio. Lähes kaikki työ kohdistuu yhteen taloyhtiöön,
 * joten moduulit avataan yhtiön korttinäkymästä (`company-tabs.ts`), eikä
 * sivupalkissa ole niille omia linkkejä. Globaalit reitit (/huoltopyynnot,
 * /talous jne.) ovat edelleen olemassa työpöydän ja muiden linkkien käyttöön.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: OrgRole[];
}

/** Yläosa: työpöytä ja yhtiön valinta. */
export const STAFF_NAV: NavItem[] = [
  { href: "/tyopoyta", label: "Työpöytä", icon: "home" },
  { href: "/taloyhtiot", label: "Taloyhtiöt", icon: "building" },
];

/** Alaosa: organisaatiotason asiat, jotka eivät kuulu yhteen yhtiöön. */
export const STAFF_NAV_ORG: NavItem[] = [
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
