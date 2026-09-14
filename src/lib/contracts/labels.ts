export const CONTRACT_CATEGORIES = [
  "insurance", "maintenance_service", "cleaning", "electricity", "heating", "water", "waste", "antenna_broadband", "elevator", "other",
] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export const CONTRACT_CATEGORY_LABEL: Record<ContractCategory, string> = {
  insurance: "Vakuutus",
  maintenance_service: "Kiinteistöhuolto",
  cleaning: "Siivous",
  electricity: "Sähkö",
  heating: "Lämpö",
  water: "Vesi",
  waste: "Jätehuolto",
  antenna_broadband: "Antenni ja laajakaista",
  elevator: "Hissi",
  other: "Muu",
};

export const CONTRACT_STATUS_LABEL = { active: "Voimassa", ending: "Päättymässä", ended: "Päättynyt" } as const;
