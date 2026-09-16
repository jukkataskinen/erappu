import { z } from "zod";
import { isValidBusinessId, normalizeBusinessId } from "@/lib/validation/finnish";
import { WORK_TYPE_LABELS } from "./work-types";

/**
 * Muutostyöilmoituksen lomakkeen tarkistukset.
 *
 * Puhdasta logiikkaa, jotta samat säännöt voi testata ilman kantaa ja ilman
 * Nextin lomakekerrosta. Työrivit tulevat lomakkeelta rinnakkaisina
 * kenttäjonoina (`work_type[]`, `work_description[]`, …), joten ne kootaan
 * riveiksi tässä eikä server actionissa.
 */

/** Yhdellä ilmoituksella enintään näin monta työtä. Lomakkeella on yhtä monta lohkoa. */
export const MAX_NOTICE_WORKS = 4;

/** Liitteitä enintään näin monta kerralla. */
export const MAX_NOTICE_ATTACHMENTS = 5;

export const CONTRACTOR_KINDS = ["contractor", "shareholder", "unknown"] as const;
export type ContractorKind = (typeof CONTRACTOR_KINDS)[number];

export const CONTRACTOR_KIND_LABEL: Record<ContractorKind, string> = {
  contractor: "Urakoitsija tai muu ulkopuolinen tekijä",
  shareholder: "Osakas itse",
  unknown: "Ei ilmoitettu",
};

/** Ilmoituksen yhteiset kentät. Työrivit tarkistetaan erikseen. */
export const noticeSchema = z.object({
  share_group_id: z.string().uuid("Valitse huoneisto."),
  description: z.string().min(10, "Kerro lyhyesti, mitä huoneistossa tehdään.").max(4000),
  // Kuittaus on pakollinen: selain lähettää valintaruudun arvon vain valittuna.
  guide_ack: z.preprocess(
    (v) => v === "on" || v === "1" || v === "true",
    z.boolean().refine((v) => v, "Kuittaa muutostyöohjeen lukeminen ennen ilmoituksen lähettämistä."),
  ),
  notify_email: z.preprocess((v) => v === "on" || v === "1" || v === "true", z.boolean()),
  notify_sms: z.preprocess((v) => v === "on" || v === "1" || v === "true", z.boolean()),
});

export type NoticeFields = z.infer<typeof noticeSchema>;

/** Lomakkeen yhden työlohkon raakakentät. Tyhjä lohko jätetään huomiotta. */
export interface RawNoticeWork {
  work_type?: string;
  description?: string;
  planned_start?: string;
  planned_end?: string;
  contractor_kind?: string;
  contractor_name?: string;
  contractor_business_id?: string;
  contractor_contact?: string;
  contractor_qualification?: string;
}

export interface NoticeWorkInput {
  workType: string;
  description: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  contractorKind: ContractorKind;
  contractorName: string | null;
  contractorBusinessId: string | null;
  contractorContact: string | null;
  contractorQualification: string | null;
}

const trim = (v: string | undefined) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: string | undefined) => trim(v) || null;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function isEmptyRow(raw: RawNoticeWork): boolean {
  return (
    !trim(raw.work_type) && !trim(raw.description) && !trim(raw.planned_start) && !trim(raw.planned_end) &&
    !trim(raw.contractor_name) && !trim(raw.contractor_business_id) && !trim(raw.contractor_contact) && !trim(raw.contractor_qualification)
  );
}

/**
 * Kokoaa ja tarkistaa työrivit. Tyhjät lohkot pudotetaan, jotta osakkaan ei
 * tarvitse täyttää kaikkia lohkoja. Virhe kerrotaan rivin numerolla, koska
 * lomakkeella on useita samanlaisia kenttiä.
 */
export function parseNoticeWorks(rows: RawNoticeWork[]): { error: string } | { value: NoticeWorkInput[] } {
  const filled = rows.filter((r) => !isEmptyRow(r));
  if (filled.length === 0) return { error: "Lisää vähintään yksi muutostyö." };
  if (filled.length > MAX_NOTICE_WORKS) return { error: `Yhdellä ilmoituksella voi olla enintään ${MAX_NOTICE_WORKS} muutostyötä.` };

  const value: NoticeWorkInput[] = [];
  for (const [i, raw] of filled.entries()) {
    const n = i + 1;
    const workType = trim(raw.work_type);
    if (!WORK_TYPE_LABELS.includes(workType)) return { error: `Työ ${n}: valitse työlaji luettelosta.` };
    const description = trim(raw.description);
    if (description.length < 10) return { error: `Työ ${n}: kuvaa työ tarkemmin (vähintään 10 merkkiä).` };
    if (description.length > 2000) return { error: `Työ ${n}: kuvaus on liian pitkä.` };

    const plannedStart = orNull(raw.planned_start);
    const plannedEnd = orNull(raw.planned_end);
    if (plannedStart && !isDate(plannedStart)) return { error: `Työ ${n}: tarkista aloituspäivä.` };
    if (plannedEnd && !isDate(plannedEnd)) return { error: `Työ ${n}: tarkista valmistumispäivä.` };
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) return { error: `Työ ${n}: valmistumispäivä ei voi olla ennen aloitusta.` };

    const kind = trim(raw.contractor_kind);
    if (kind !== "contractor" && kind !== "shareholder") return { error: `Työ ${n}: valitse, teetkö työn itse vai teettääkö sen urakoitsija.` };

    let contractorName = orNull(raw.contractor_name);
    let businessId = orNull(raw.contractor_business_id);
    let contact = orNull(raw.contractor_contact);
    if (kind === "shareholder") {
      // Osakas tekee itse: yrityksen tietoja ei tallenneta, vaikka kenttiin olisi jäänyt tekstiä.
      contractorName = null;
      businessId = null;
      contact = null;
    } else {
      if (!contractorName) return { error: `Työ ${n}: kerro työn tekevän yrityksen nimi.` };
      if (contractorName.length > 200) return { error: `Työ ${n}: yrityksen nimi on liian pitkä.` };
      if (businessId) {
        const normalized = normalizeBusinessId(businessId);
        if (!isValidBusinessId(normalized)) return { error: `Työ ${n}: tarkista urakoitsijan Y-tunnus.` };
        businessId = normalized;
      }
      if (contact && contact.length > 200) return { error: `Työ ${n}: yhteystieto on liian pitkä.` };
    }

    const qualification = orNull(raw.contractor_qualification);
    if (qualification && qualification.length > 500) return { error: `Työ ${n}: pätevyystieto on liian pitkä.` };

    value.push({
      workType,
      description,
      plannedStart,
      plannedEnd,
      contractorKind: kind,
      contractorName,
      contractorBusinessId: businessId,
      contractorContact: contact,
      contractorQualification: qualification,
    });
  }
  return { value };
}

/** Lomakkeen rinnakkaiset kenttäjonot riveiksi. */
export function noticeWorkRowsFromValues(values: Partial<Record<keyof RawNoticeWork, string[]>>): RawNoticeWork[] {
  const keys = Object.keys(values) as (keyof RawNoticeWork)[];
  const count = Math.min(MAX_NOTICE_WORKS, Math.max(0, ...keys.map((k) => values[k]?.length ?? 0)));
  return Array.from({ length: count }, (_, i) => {
    const row: RawNoticeWork = {};
    for (const k of keys) row[k] = values[k]?.[i] ?? "";
    return row;
  });
}

/** Yhteenveto työlajeista listoihin ja nostoihin. */
export function workSummary(workTypes: string | null, count: number): string {
  if (!workTypes || count === 0) return "Muutostyö";
  const parts = workTypes.split(", ").filter(Boolean);
  if (parts.length <= 2) return parts.join(" ja ");
  return `${parts[0]} ja ${parts.length - 1} muuta työtä`;
}
