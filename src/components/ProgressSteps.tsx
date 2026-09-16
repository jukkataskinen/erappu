import type { Progress } from "@/lib/progress";

/** Etenemisjana: valmiit vaiheet täytettyinä, nykyinen korostettuna. */
export function ProgressSteps({ progress, className }: { progress: Progress; className?: string }) {
  if (progress.ended) {
    return <p className={`text-sm text-ink/70 ${className ?? ""}`}>{progress.ended}</p>;
  }
  const current = progress.steps.find((s) => s.state === "current")?.label;
  return (
    <div className={className}>
      <ol className="grid grid-cols-4 gap-1" aria-label={current ? `Eteneminen, nyt: ${current}` : "Eteneminen: valmis"}>
        {progress.steps.map((s, i) => (
          <li key={s.label} className="min-w-0" aria-current={s.state === "current" ? "step" : undefined}>
            <div className="flex items-center">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                  s.state === "done" ? "border-moss bg-moss text-paper" : s.state === "current" ? "border-sky bg-sky-soft text-sky" : "border-line bg-paper text-ink/40"
                }`}
              >
                {s.state === "done" ? "✓" : i + 1}
              </span>
              {i < progress.steps.length - 1 ? <span className={`mx-1 h-0.5 flex-1 rounded ${s.state === "done" ? "bg-moss" : "bg-line"}`} /> : null}
            </div>
            <span className={`mt-1 block truncate text-xs ${s.state === "todo" ? "text-ink/45" : "font-semibold text-ink/80"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      {progress.note ? <p className="mt-2 text-xs text-ink/65">{progress.note}</p> : null}
    </div>
  );
}
