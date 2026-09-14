/**
 * Taloyhtiösivun välilehdet. Moduulit omistavat omat sivunsa polun
 * /taloyhtiot/[id]/<avain> alla; tämä lista on ainoa yhteinen kohta.
 */
export const COMPANY_TABS = [
  { key: "yleiset", label: "Yleiset", path: "" },
  { key: "huoneistot", label: "Huoneistot", path: "/huoneistot" },
  { key: "osakkaat", label: "Osakkaat", path: "/osakkaat" },
  { key: "hallitus", label: "Hallitus", path: "/hallitus" },
  { key: "kiinteisto", label: "Kiinteistö", path: "/kiinteisto" },
  { key: "huolto", label: "Huolto", path: "/huolto" },
  { key: "talous", label: "Talous", path: "/talous" },
  { key: "korjaukset", label: "Korjaukset", path: "/korjaukset" },
  { key: "kokoukset", label: "Kokoukset", path: "/kokoukset" },
  { key: "dokumentit", label: "Dokumentit", path: "/dokumentit" },
  { key: "htj", label: "HTJ", path: "/htj" },
] as const;

export type CompanyTabKey = (typeof COMPANY_TABS)[number]["key"];

export function companyTabs(companyId: string) {
  return COMPANY_TABS.map((t) => ({ key: t.key, label: t.label, href: `/taloyhtiot/${companyId}${t.path}` }));
}
