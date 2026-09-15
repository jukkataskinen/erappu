export const TASK_CATEGORIES = ["financial_statement", "general_meeting", "htj_update", "insurance", "maintenance", "safety", "contract", "other"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  financial_statement: "Tilinpäätös ja talous",
  general_meeting: "Yhtiökokous",
  htj_update: "HTJ",
  insurance: "Vakuutukset",
  maintenance: "Kunnossapito",
  safety: "Turvallisuus",
  contract: "Sopimukset",
  other: "Muu",
};
