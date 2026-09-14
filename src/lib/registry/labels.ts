export const COMPANY_FORM: Record<string, string> = {
  asunto_oy: "Asunto-osakeyhtiö",
  koy: "Keskinäinen kiinteistöosakeyhtiö",
  other: "Muu",
};

export const SHARE_GROUP_KIND: Record<string, string> = {
  apartment: "Asuinhuoneisto",
  commercial: "Liikehuoneisto",
  parking: "Autopaikka",
  garage: "Autotalli",
  storage: "Varasto",
  other: "Muu",
};

export const BOARD_ROLE: Record<string, string> = {
  chair: "Puheenjohtaja",
  member: "Jäsen",
  deputy: "Varajäsen",
  operations_auditor: "Toiminnantarkastaja",
  deputy_operations_auditor: "Varatoiminnantarkastaja",
  auditor: "Tilintarkastaja",
};

export const SOURCE: Record<string, string> = { htj: "HTJ", manual: "Käsin", migration: "Access" };

export const REDEMPTION_CLAUSE: { key: string; label: string }[] = [
  { key: "company", label: "Lunastusoikeus yhtiöllä" },
  { key: "shareholder", label: "Lunastusoikeus osakkaalla" },
  { key: "other", label: "Lunastusoikeus muulla" },
  { key: "municipality_hitas", label: "Kunnan lunastusoikeus (Hitas)" },
  { key: "municipality_law", label: "Kunnan lunastusoikeus (laki 235/1991)" },
  { key: "widow_right", label: "Lesken hallintaoikeus" },
  { key: "other_restriction", label: "Muu rajoitus" },
];
