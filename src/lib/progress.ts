import { formatDate } from "@/lib/format";
import type { RenovationStatus } from "@/lib/maintenance/renovation";
import type { RequestStatus } from "@/lib/service-requests/labels";

/**
 * Portaalin etenemisjana: neljä vaihetta, joista osakas näkee, missä
 * muutostyöilmoitus tai huoltopyyntö on. Päättynyt ilman valmistumista
 * (kielletty, hylätty, peruttu) näytetään janan sijaan omana tilanaan.
 */

export type StepState = "done" | "current" | "todo";

export interface Progress {
  steps: { label: string; state: StepState }[];
  /** Nykyisen vaiheen tarkennus, esim. "Lisätietoja pyydetty". */
  note: string | null;
  /** Käsittely päättyi ilman valmistumista. */
  ended: string | null;
}

function build(labels: string[], current: number, complete: boolean, note: string | null = null): Progress {
  return {
    steps: labels.map((label, i) => ({ label, state: complete || i < current ? "done" : i === current ? "current" : "todo" })),
    note,
    ended: null,
  };
}

const ended = (labels: string[], text: string): Progress => ({ steps: labels.map((label) => ({ label, state: "todo" })), note: null, ended: text });

export const RENOVATION_STEPS = ["Vastaanotettu", "Hyväksytty", "Työn alla", "Valmis"];

export function renovationProgress(status: RenovationStatus): Progress {
  switch (status) {
    case "received":
      return build(RENOVATION_STEPS, 1, false, "Odottaa yhtiön käsittelyä. Älä aloita työtä ennen hyväksyntää.");
    case "info_requested":
      return build(RENOVATION_STEPS, 1, false, "Yhtiö on pyytänyt lisätietoja ennen päätöstä.");
    case "approved":
      return build(RENOVATION_STEPS, 2, false, "Työn voi aloittaa.");
    case "approved_with_conditions":
      return build(RENOVATION_STEPS, 2, false, "Hyväksytty ehdoin. Noudata päätöksen ehtoja.");
    case "in_progress":
      return build(RENOVATION_STEPS, 3, false);
    case "completed":
      return build(RENOVATION_STEPS, 3, true);
    case "denied":
      return ended(RENOVATION_STEPS, "Yhtiö ei hyväksynyt muutostyötä.");
    case "cancelled":
      return ended(RENOVATION_STEPS, "Ilmoitus on peruttu.");
  }
}

export const REQUEST_STEPS = ["Vastaanotettu", "Tilattu", "Työn alla", "Valmis"];

/**
 * `provider` on tilauksen saaneen palveluntuottajan nimi ja `promisedOn`
 * (VVVV-KK-PP) hänen lupaamansa takaraja. Ilmoittajalle kerrotaan, keneltä työ
 * on tilattu ja milloin se viimeistään tehdään (Jukka 23.9.2026): muuten jana
 * kertoo vain, että työ on tilattu jollekin.
 */
export function requestProgress(status: RequestStatus, provider?: string | null, promisedOn?: string | null): Progress {
  const tilaaja = provider?.trim() || null;
  const lupaus = promisedOn ? `Työ tehdään viimeistään ${formatDate(promisedOn)}.` : null;
  const note = (...osat: (string | null)[]) => osat.filter(Boolean).join(" ") || null;
  switch (status) {
    case "new":
      return build(REQUEST_STEPS, 0, false, "Odottaa isännöinnin käsittelyä.");
    case "received":
      return build(REQUEST_STEPS, 1, false, lupaus);
    case "ordered":
      return build(REQUEST_STEPS, 2, false, note(tilaaja ? `Työ on tilattu: ${tilaaja}.` : "Työ on tilattu korjaajalta.", lupaus));
    case "in_progress":
      return build(REQUEST_STEPS, 3, false, note(tilaaja ? `${tilaaja} tekee työtä.` : null, lupaus));
    case "waiting":
      return build(REQUEST_STEPS, 3, false, note("Odottaa, esimerkiksi osia tai kulkuoikeutta.", lupaus));
    case "done":
      return build(REQUEST_STEPS, 3, true, "Kuittaa korjatuksi, jos vika on poissa.");
    case "closed":
      return build(REQUEST_STEPS, 3, true);
    case "rejected":
      return ended(REQUEST_STEPS, "Pyyntöä ei käsitelty korjaustyönä.");
  }
}
