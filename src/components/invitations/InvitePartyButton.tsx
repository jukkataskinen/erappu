"use client";

import { useActionState } from "react";
import { invitePartyToPortal, type InvitePartyState } from "@/lib/invitations/actions";

const initial: InvitePartyState = { status: "idle", message: null };

/**
 * "Kutsu portaaliin" -nappi rekisterin omistaja-, asukas- ja hallitusriveille.
 * Näytetään vain owner/managerille (sivu päättää). Jos osapuoli on jo
 * portaalissa tai sähköposti puuttuu, nappia ei näytetä tai palvelin kertoo syyn.
 */
export function InvitePartyButton({
  partyId,
  companyId,
  role,
  hasEmail,
  hasPortal = false,
}: {
  partyId: string;
  companyId: string;
  role: "owner" | "resident" | "board";
  hasEmail: boolean;
  hasPortal?: boolean;
}) {
  const [state, action, pending] = useActionState(invitePartyToPortal, initial);
  if (hasPortal) return null;
  if (!hasEmail) return <span className="text-xs text-ink/50">Ei sähköpostia portaalikutsuun</span>;
  if (state.status === "sent" && state.link) {
    return (
      <div className="flex max-w-xs flex-col items-end gap-1" role="status">
        <span className="text-right text-xs text-ink/70">{state.message}</span>
        <input
          readOnly
          value={state.link}
          aria-label="Kutsulinkki"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-line bg-cloud px-2 py-1 text-xs"
        />
        <button type="button" className="text-xs font-semibold text-sky" onClick={() => void navigator.clipboard?.writeText(state.link!)}>
          Kopioi linkki
        </button>
        <span className="text-right text-xs text-ink/50">Voimassa 14 päivää. Vastaanottaja kirjautuu samalla sähköpostiosoitteella.</span>
      </div>
    );
  }
  if (state.status === "sent" || state.status === "already") {
    return (
      <span className={state.status === "sent" ? "text-xs text-moss" : "text-xs text-ink/60"} role="status">
        {state.message}
      </span>
    );
  }
  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="party_id" value={partyId} />
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="role" value={role} />
      <button className="text-xs text-sky disabled:opacity-50" disabled={pending}>
        {pending ? "Lähetetään…" : "Kutsu portaaliin"}
      </button>
      {state.status === "error" ? (
        <span className="text-xs text-coral" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
