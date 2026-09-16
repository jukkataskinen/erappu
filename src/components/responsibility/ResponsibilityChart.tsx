/** @jsxRuntime automatic */
/** @jsxImportSource react */
"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ROOM_ART } from "@/components/responsibility/rooms";
import { formatDate } from "@/lib/format";
import { RESPONSIBILITIES, RESPONSIBILITY_DESCRIPTION, RESPONSIBILITY_LABEL, RESPONSIBILITY_PHRASE, ROOMS, VIEW_BOX, type Responsibility, type RoomKey } from "@/lib/responsibility/content";
import { EXCEPTION_BASIS_LABEL, type ChartItem } from "@/lib/responsibility/merge";

/**
 * Interaktiivinen vastuunjakotaulukko. Pisteen valinta avaa tiedot kuvan alle
 * eikä tooltipiin, koska puhelimessa hover-vihjettä ei ole. Sama tieto on
 * aina näkyvissä myös luettelona kuvan alla, jotta sen saa ilman klikkailua
 * ja ruudunlukijalla.
 *
 * Värit: koralli = yhtiö, sininen = osakas, puolikkaat = jaettu. Väri ei ole
 * ainoa vihje: pisteellä on aria-label ja luettelossa vastuu on tekstinä.
 */

const DOT_BG: Record<Responsibility, string> = {
  company: "var(--color-coral)",
  shareholder: "var(--color-sky)",
  shared: "linear-gradient(90deg, var(--color-coral) 50%, var(--color-sky) 50%)",
};

// Samat sävyt kuin `Badge`-komponentissa (ui.tsx). Oma kopio, koska tämä
// komponentti renderöidään myös testissä automaattisella JSX-ajolla.
const PILL = {
  alert: "bg-coral-soft text-coral border-coral/25",
  info: "bg-sky-soft text-sky border-sky/20",
  neutral: "bg-cloud text-ink/70 border-line",
  warn: "bg-amber-soft text-amber border-amber/25",
} as const;

const BADGE_TONE: Record<Responsibility, keyof typeof PILL> = {
  company: "alert",
  shareholder: "info",
  shared: "neutral",
};

function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PILL[tone]}`}>{children}</span>;
}

function Swatch({ value, size = 14 }: { value: Responsibility; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full border-2 border-paper shadow-[0_0_0_1px_rgba(27,42,65,0.25)]" style={{ width: size, height: size, background: DOT_BG[value] }} />;
}

function ResponsibilityBadge({ value }: { value: Responsibility }) {
  return (
    <Pill tone={BADGE_TONE[value]}>
      <span className="inline-flex items-center gap-1.5">
        <Swatch value={value} size={10} />
        {RESPONSIBILITY_LABEL[value]}
      </span>
    </Pill>
  );
}

function ExceptionBox({ item }: { item: ChartItem }) {
  const e = item.exception;
  if (!e) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber/30 bg-amber-soft px-3.5 py-2.5 text-sm">
      <p className="font-semibold text-ink">
        Tässä yhtiössä poikkeus: {RESPONSIBILITY_PHRASE[e.responsibility]}
      </p>
      <p className="mt-0.5 text-ink/80">
        Peruste: {EXCEPTION_BASIS_LABEL[e.basis]}
        {e.decided_on ? `, ${formatDate(e.decided_on)}` : ""}
      </p>
      <p className="mt-1 whitespace-pre-line text-ink/80">{e.note}</p>
      <p className="mt-1 text-xs text-ink/60">Lain yleinen tulkinta olisi: {RESPONSIBILITY_PHRASE[item.responsibility]}. Yleinen perustelu alla.</p>
    </div>
  );
}

function ItemDetails({ item }: { item: ChartItem }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base">{item.label}</h3>
        <ResponsibilityBadge value={item.effective} />
        {item.exception ? <Pill tone="warn">Poikkeus</Pill> : null}
      </div>
      <ExceptionBox item={item} />
      <p className={`mt-2 text-sm ${item.exception ? "text-ink/60" : "text-ink/85"}`}>{item.text}</p>
      <p className="mt-1.5 text-xs font-semibold text-ink/60">Peruste: {item.law}</p>
      {item.note ? <p className="mt-1.5 text-sm text-ink/70">Huomaa: {item.note}</p> : null}
    </>
  );
}

export function ResponsibilityChart({ items, initialRoom = "keittio" }: { items: ChartItem[]; initialRoom?: RoomKey }) {
  const [room, setRoom] = useState<RoomKey>(initialRoom);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const detailsId = `${baseId}-details`;

  const roomItems = items.filter((i) => i.room === room);
  const selected = roomItems.find((i) => i.key === selectedKey) ?? null;
  const current = ROOMS.find((r) => r.key === room)!;
  const Art = ROOM_ART[room];
  const exceptionCount = roomItems.filter((i) => i.exception).length;

  function chooseRoom(key: RoomKey) {
    setRoom(key);
    setSelectedKey(null);
  }

  // Välilehtien nuolinäppäimet WAI-ARIA-mallin mukaan.
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = ROOMS.length - 1;
    const next = e.key === "ArrowRight" ? (index === last ? 0 : index + 1) : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    chooseRoom(ROOMS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Tilat" className="flex flex-wrap gap-1.5">
        {ROOMS.map((r, index) => {
          const active = r.key === room;
          const hasException = items.some((i) => i.room === r.key && i.exception);
          return (
            <button
              key={r.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${r.key}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => chooseRoom(r.key)}
              onKeyDown={(e) => onTabKey(e, index)}
              className={`inline-flex min-h-[var(--size-touch)] items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${
                active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink/75 hover:border-ink/30 hover:text-ink"
              }`}
            >
              {r.label}
              {hasException ? <span aria-label="sisältää poikkeuksen" className={`h-2 w-2 rounded-full ${active ? "bg-amber-soft" : "bg-amber"}`} /> : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${baseId}-tab-${room}`} className="grid gap-4">
        <p className="text-sm text-ink/70">{current.intro}</p>

        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Merkkien selitys">
          {RESPONSIBILITIES.map((r) => (
            <li key={r} className="flex items-center gap-2">
              <Swatch value={r} />
              <span>
                <span className="font-semibold">{RESPONSIBILITY_LABEL[r]}</span>
                <span className="sr-only">: {RESPONSIBILITY_DESCRIPTION[r]}</span>
              </span>
            </li>
          ))}
          {exceptionCount > 0 ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-2 border-dashed border-amber" />
              <span className="font-semibold">Yhtiökohtainen poikkeus</span>
            </li>
          ) : null}
        </ul>

        <div className="relative w-full overflow-hidden rounded-xl border border-line bg-cloud" style={{ aspectRatio: `${VIEW_BOX.width} / ${VIEW_BOX.height}` }}>
          <svg viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`} className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
            <Art />
          </svg>
          {roomItems.map((item) => {
            const isSelected = item.key === selectedKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(isSelected ? null : item.key)}
                aria-pressed={isSelected}
                aria-controls={detailsId}
                aria-label={`${item.label}: ${RESPONSIBILITY_LABEL[item.effective]}${item.exception ? ", yhtiökohtainen poikkeus" : ""}`}
                title={item.label}
                className="group absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none"
                style={{ left: `${(item.x / VIEW_BOX.width) * 100}%`, top: `${(item.y / VIEW_BOX.height) * 100}%` }}
              >
                <span
                  aria-hidden
                  className={`block rounded-full border-[3px] border-paper shadow-[0_1px_4px_rgba(27,42,65,0.45)] transition-transform group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-ink ${
                    isSelected ? "h-7 w-7 ring-4 ring-ink" : "h-6 w-6"
                  }`}
                  style={{ background: DOT_BG[item.effective] }}
                />
                {item.exception ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-amber" /> : null}
              </button>
            );
          })}
        </div>

        <div id={detailsId} aria-live="polite" className="rounded-xl border border-line bg-paper px-4 py-3.5">
          {selected ? <ItemDetails item={selected} /> : <p className="text-sm text-ink/60">Valitse kohde kuvasta, niin sen vastuu ja peruste näkyvät tässä. Kaikki kohteet ovat myös luettelossa alla.</p>}
        </div>

        <div>
          <h3 className="text-base">Kaikki kohteet: {current.label.toLowerCase()}</h3>
          <ul className="mt-2 grid gap-2">
            {roomItems.map((item) => (
              <li key={item.key} className={`rounded-xl border px-4 py-3 ${item.key === selectedKey ? "border-ink/40 bg-sky-soft/40" : "border-line bg-paper"}`}>
                <ItemDetails item={item} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
