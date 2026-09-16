"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { approveMarketplaceReservation, type ApproveState } from "../tori-actions";

const initial: ApproveState = { status: "idle" };

/** Rajan ylittävän torivarauksen hyväksyntä. Tehtävälinkki näytetään jaettavaksi, koska sähköposti ei välttämättä tavoita tekijää. */
export function ApproveReservation({ requestId, listingId }: { requestId: string; listingId: string }) {
  const [state, action, pending] = useActionState(approveMarketplaceReservation, initial);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  if (state.status === "ready") {
    return (
      <div className="grid gap-2 rounded-xl border border-moss/25 bg-moss-soft p-3" role="status">
        <p className="text-sm font-semibold text-moss">
          Varaus hyväksytty ja työ tilattu.{state.emailed ? " Tilaus lähti myös sähköpostiin jonoon." : ""} Lähetä tehtävälinkki tekijälle.
        </p>
        <textarea readOnly value={state.text} rows={4} aria-label="Viesti palveluntuottajalle" className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs" />
        <div className="flex flex-wrap gap-2">
          <a
            href={state.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[var(--size-touch)] items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-strong"
          >
            Jaa WhatsAppiin
          </a>
          <button
            type="button"
            className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-line bg-paper px-4 text-sm font-semibold"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.text);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Kopioitu" : "Kopioi viesti"}
          </button>
          <button type="button" className="inline-flex min-h-[var(--size-touch)] items-center px-2 text-sm font-semibold text-ink/70 hover:text-ink" onClick={() => router.refresh()}>
            Valmis
          </button>
        </div>
        <p className="text-xs text-ink/60">Linkki näkyy vain nyt. Paina Valmis, kun olet lähettänyt sen.</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="listing_id" value={listingId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[var(--size-touch)] w-fit items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-strong disabled:opacity-50"
      >
        {pending ? "Hyväksytään…" : "Hyväksy varaus ja tilaa työ"}
      </button>
      {state.status === "error" ? (
        <span className="text-xs text-coral" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
