"use client";

import { useActionState, useState } from "react";
import { createProviderMarketplaceLink, type LinkState } from "../tori-actions";

const initial: LinkState = { status: "idle" };

/** Torilinkin luonti ja jako. Linkki näkyy vain tässä, kannassa on sen tiiviste. */
export function MarketplaceLinkShare({ providerId, hasLink }: { providerId: string; hasLink: boolean }) {
  const [state, action, pending] = useActionState(createProviderMarketplaceLink, initial);
  const [copied, setCopied] = useState(false);

  if (state.status === "ready") {
    return (
      <div className="grid gap-2 rounded-xl border border-moss/25 bg-moss-soft p-3" role="status">
        <p className="text-sm font-semibold text-moss">Torilinkki luotu. Lähetä se palveluntuottajalle.</p>
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
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="provider_id" value={providerId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[var(--size-touch)] w-fit items-center rounded-full border border-line bg-paper px-4 text-sm font-semibold hover:border-ink/30 disabled:opacity-50"
      >
        {pending ? "Luodaan…" : hasLink ? "Luo uusi torilinkki" : "Luo torilinkki"}
      </button>
      {hasLink ? <span className="text-xs text-ink/55">Uusi linkki mitätöi edellisen.</span> : null}
      {state.status === "error" ? (
        <span className="text-xs text-coral" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
