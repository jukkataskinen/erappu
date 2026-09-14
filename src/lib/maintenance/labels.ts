export type NeedStatus = "planned" | "decided" | "in_progress" | "done" | "postponed" | "cancelled";

export const NEED_STATUS_LABEL: Record<NeedStatus, string> = {
  planned: "Suunniteltu",
  decided: "Päätetty",
  in_progress: "Käynnissä",
  done: "Valmis",
  postponed: "Siirretty",
  cancelled: "Peruttu",
};

export const PERFORMED_BY_LABEL: Record<string, string> = { company: "Yhtiö", shareholder: "Osakas" };

export const WORK_SOURCE_LABEL: Record<string, string> = {
  manual: "Käsin",
  migration: "Access",
  renovation_notice: "Muutostyöilmoitus",
  htj: "HTJ",
};
