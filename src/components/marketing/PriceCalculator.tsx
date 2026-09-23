"use client";

import { useId, useState } from "react";
import { formatEuro, priceSummary, VAT_NOTE, YEARLY_MONTHLY, MONTHLY, type Billing } from "@/content/pricing";

/**
 * Hintalaskuri: taloyhtiöiden ja huoneistojen määrä sisään, hinta ulos.
 * Laskenta on `content/pricing.ts`:ssä, jotta hinta on yhdessä paikassa.
 */
export function PriceCalculator() {
  const [companies, setCompanies] = useState(1);
  const [units, setUnits] = useState(15);
  const [billing, setBilling] = useState<Billing>("yearly");
  const id = useId();
  const sum = priceSummary(companies, units, billing);
  const rates = billing === "yearly" ? YEARLY_MONTHLY : MONTHLY;

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
      <div className="grid gap-5">
        <div role="group" aria-label="Laskutusjakso" className="inline-flex w-fit rounded-full border border-line p-1">
          {(["yearly", "monthly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBilling(option)}
              aria-pressed={billing === option}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${billing === option ? "bg-ink text-paper" : "text-ink/70 hover:text-ink"}`}
            >
              {option === "yearly" ? "Vuosi etukäteen −10 %" : "Kuukausilaskutus"}
            </button>
          ))}
        </div>

        <label className="grid gap-1.5" htmlFor={`${id}-companies`}>
          <span className="font-medium">Taloyhtiöitä</span>
          <input
            id={`${id}-companies`}
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={companies}
            onChange={(e) => setCompanies(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
            className="min-h-11 w-32 rounded-xl border border-line bg-paper px-3"
          />
        </label>

        <label className="grid gap-1.5" htmlFor={`${id}-units`}>
          <span className="font-medium">Huoneistoja yhtiössä</span>
          <input
            id={`${id}-units`}
            type="range"
            min={1}
            max={120}
            value={units}
            onChange={(e) => setUnits(Number(e.target.value))}
            className="w-full accent-[var(--color-ink)]"
          />
          <span className="text-sm text-ink/70">{units} huoneistoa</span>
        </label>

        <p className="text-sm text-ink/70">
          {formatEuro(rates.base)} / kk / taloyhtiö + {formatEuro(rates.perUnit)} / huoneisto / kk, vähintään {formatEuro(rates.minimum)} / kk. {VAT_NOTE}
        </p>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-line bg-cloud p-6" aria-live="polite">
        <p className="text-sm text-ink/60">{companies === 1 ? "Taloyhtiö" : `${companies} taloyhtiötä`}, {units} huoneistoa</p>
        <p className="mt-1 text-[32px] font-extrabold leading-tight">{formatEuro(sum.totalMonth)}<span className="text-lg font-medium text-ink/60"> / kk</span></p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/60">Vuodessa</dt>
            <dd className="tabular-nums">{formatEuro(sum.totalYear)}</dd>
          </div>
          {companies > 1 ? (
            <div className="flex justify-between gap-4 border-t border-line pt-2">
              <dt className="text-ink/60">Yhtä taloyhtiötä kohden</dt>
              <dd className="tabular-nums">{formatEuro(sum.perCompanyMonth)} / kk</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/60">Huoneistoa kohden</dt>
            <dd className="tabular-nums">{formatEuro(sum.perCompanyMonth / Math.max(1, units))} / kk</dd>
          </div>
        </dl>
        {billing === "yearly" ? (
          <p className="mt-4 text-sm text-moss">Vuosimaksu säästää {formatEuro(sum.yearlySaving)} vuodessa kuukausilaskutukseen verrattuna.</p>
        ) : (
          <p className="mt-4 text-sm text-ink/70">Vuosi etukäteen maksettuna hinta olisi {formatEuro(priceSummary(companies, units, "yearly").totalMonth)} / kk.</p>
        )}
      </div>
    </div>
  );
}
