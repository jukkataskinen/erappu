import Link from "next/link";
import { shortFinnishDate } from "@/lib/tasks/dates";
import {
  arcPath,
  DOT_RADIUS,
  layoutWheel,
  MONTH_RING,
  MONTH_SHORT,
  polar,
  SEASON_RING,
  SEASONS,
  WHEEL_CENTER,
  WHEEL_RINGS,
  WHEEL_SIZE,
  type WheelItem,
  type WheelRingKey,
} from "@/lib/tasks/wheel";

/** Vuosikello ympyräkuvana ja numeroitu selite kehittäin. */

const SEASON_FILL: Record<string, string> = {
  winter: "var(--color-sky-soft)",
  spring: "var(--color-moss-soft)",
  summer: "var(--color-amber-soft)",
  autumn: "var(--color-coral-soft)",
};
const SEASON_TEXT: Record<string, string> = {
  winter: "var(--color-sky)",
  spring: "var(--color-moss)",
  summer: "var(--color-amber)",
  autumn: "var(--color-coral)",
};
const RING_COLOR: Record<WheelRingKey, string> = {
  board: "var(--color-ink)",
  property: "var(--color-moss)",
  communication: "var(--color-sky)",
};

export function AnnualCycleWheel({ items, caption, emptyText = "Ei tehtäviä seuraavalle 12 kuukaudelle." }: { items: WheelItem[]; caption: string; emptyText?: string }) {
  const markers = layoutWheel(items);
  const rings = WHEEL_RINGS.filter((r) => markers.some((m) => m.ring === r.key));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <svg viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`} role="img" aria-label={`Vuosikello: ${caption}`} className="mx-auto w-full max-w-[26rem]">
        {SEASONS.map((s) => {
          const start = ((s.startMonth - 1) / 12) * 360;
          const end = start + (s.months / 12) * 360;
          const mid = polar((start + end) / 2, (SEASON_RING.inner + SEASON_RING.outer) / 2);
          return (
            <g key={s.key}>
              <path d={arcPath(start, end, SEASON_RING.inner, SEASON_RING.outer)} fill={SEASON_FILL[s.key]} stroke="var(--color-paper)" strokeWidth={2} />
              <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={SEASON_TEXT[s.key]} letterSpacing={0.5}>
                {s.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {MONTH_SHORT.map((label, i) => {
          const start = (i / 12) * 360;
          const mid = polar(start + 15, (MONTH_RING.inner + MONTH_RING.outer) / 2);
          return (
            <g key={label}>
              <path d={arcPath(start, start + 30, MONTH_RING.inner, MONTH_RING.outer)} fill="var(--color-cloud)" stroke="var(--color-paper)" strokeWidth={2} />
              <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--color-ink)" opacity={0.7}>
                {label}
              </text>
            </g>
          );
        })}

        {WHEEL_RINGS.map((r) => (
          <circle key={r.key} cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={r.radius} fill="none" stroke="var(--color-line)" strokeWidth={1.5} strokeDasharray={r.key === "board" ? undefined : "3 4"} />
        ))}

        <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={64} fill="var(--color-paper)" stroke="var(--color-line)" />
        <text x={WHEEL_CENTER} y={WHEEL_CENTER - 7} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--color-ink)">
          Vuosikello
        </text>
        <text x={WHEEL_CENTER} y={WHEEL_CENTER + 12} textAnchor="middle" fontSize={10} fill="var(--color-ink)" opacity={0.6}>
          {caption}
        </text>

        {markers.map((m) => (
          <g key={`${m.number}`}>
            <title>{`${m.number}. ${shortFinnishDate(m.date)} ${m.title}`}</title>
            <circle cx={m.x} cy={m.y} r={DOT_RADIUS} fill={RING_COLOR[m.ring]} stroke="var(--color-paper)" strokeWidth={2} />
            <text x={m.x} y={m.y} textAnchor="middle" dominantBaseline="central" fontSize={m.number > 9 ? 8 : 9} fontWeight={700} fill="var(--color-paper)">
              {m.number}
            </text>
          </g>
        ))}
      </svg>

      {markers.length === 0 ? (
        <p className="text-sm text-ink/65">{emptyText}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {rings.map((r) => (
            <section key={r.key}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: RING_COLOR[r.key] }} />
                {r.label}
              </h3>
              <ol className="grid gap-1 text-sm">
                {markers
                  .filter((m) => m.ring === r.key)
                  .map((m) => (
                    <li key={m.number} className="flex gap-2">
                      <span className="tabular w-6 shrink-0 text-right font-semibold text-ink/60">{m.number}.</span>
                      <span className="tabular w-14 shrink-0 text-ink/60">{shortFinnishDate(m.date)}</span>
                      {m.href ? (
                        <Link href={m.href} className="hover:text-sky">
                          {m.title}
                        </Link>
                      ) : (
                        <span>{m.title}</span>
                      )}
                    </li>
                  ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
