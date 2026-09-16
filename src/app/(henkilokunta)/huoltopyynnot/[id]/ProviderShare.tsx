"use client";

import { useActionState, useState } from "react";
import { shareProviderOrder, type ShareOrderState } from "../share-action";

const initial: ShareOrderState = { status: "idle" };

/**
 * Tilaus jakolinkkinä: luo tehtävälinkin ja näyttää valmiin viestin, jonka voi
 * lähettää WhatsAppilla, kopioida tai jakaa puhelimen jakovalikosta. Linkki
 * näkyy vain tässä: kannassa on sen tiiviste, joten uusi jako luo uuden linkin
 * ja mitätöi edellisen.
 */
export function ProviderShare({ requestId, providerPhone, disabled, ordered }: { requestId: string; providerPhone: string | null; disabled: boolean; ordered: boolean }) {
  const [state, action, pending] = useActionState(shareProviderOrder, initial);
  const [copied, setCopied] = useState(false);

  if (state.status === "ready") {
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    return (
      <div className="grid gap-2 rounded-xl border border-moss/25 bg-moss-soft p-3" role="status">
        <p className="text-sm font-semibold text-moss">Tehtävälinkki luotu. Lähetä viesti palveluntuottajalle.</p>
        <textarea readOnly value={state.text} rows={4} aria-label="Viesti palveluntuottajalle" className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs" onFocus={(e) => e.currentTarget.select()} />
        <div className="flex flex-wrap gap-2">
          <a
            href={state.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[var(--size-touch)] items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-strong"
          >
            {providerPhone ? "Avaa WhatsApp-keskustelu" : "Jaa WhatsAppiin"}
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
          {canShare ? (
            <button
              type="button"
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-line bg-paper px-4 text-sm font-semibold"
              onClick={() => void navigator.share({ text: state.text }).catch(() => undefined)}
            >
              Jaa muualle
            </button>
          ) : null}
        </div>
        <p className="text-xs text-ink/60">Viestissä ei ole osoitetta eikä asukkaan tietoja; ne näkyvät vasta linkin takana. Uusi jako mitätöi tämän linkin.</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="id" value={requestId} />
      <button
        type="submit"
        disabled={disabled || pending}
        className="inline-flex min-h-[var(--size-touch)] w-fit items-center rounded-full border border-line bg-paper px-4 text-sm font-semibold hover:border-ink/30 disabled:opacity-50"
      >
        {pending ? "Luodaan linkkiä…" : ordered ? "Uusi jakolinkki (WhatsApp)" : "Tilaa jakolinkillä (WhatsApp)"}
      </button>
      {state.status === "error" ? (
        <span className="text-xs text-coral" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
