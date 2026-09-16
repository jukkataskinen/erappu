import { Button, Notice } from "@/components/ui";
import { ReadingChecks, ReadingConfirm, ReadingInput } from "@/components/water/ReadingChecks";
import { formatDate, formatEur } from "@/lib/format";
import { trimDecimal } from "@/lib/finance/labels";
import type { PortalWaterUnit } from "@/lib/water/queries";
import { METER_KIND } from "@/lib/water/settlement";
import { reportReadingAction } from "./water-actions";

/** Huoneiston vesimittarit portaalissa: lukeman ilmoitus avoimella kierroksella ja vesiennakko osakkaalle. */
export function WaterMeters({ unit, thanked }: { unit: PortalWaterUnit; thanked: boolean }) {
  const round = unit.openRound;
  return (
    <div id="vesi" className="mt-5 border-t border-line pt-4">
      <p className="mb-2 text-sm font-semibold">Vesimittarit</p>
      {thanked && round ? (
        <div className="mb-3">
          <Notice tone="ok">Kiitos, lukema on vastaanotettu.</Notice>
        </div>
      ) : null}
      {round ? (
        <form action={reportReadingAction} className="grid gap-3">
          <ReadingChecks>
            <input type="hidden" name="round_id" value={round.id} />
            <p className="text-sm">
              Ilmoita mittarin lukema päivältä <strong>{formatDate(round.readOn)}</strong>. Kirjoita kaikki numerot, myös desimaalit.
            </p>
            <ul className="grid gap-3">
              {unit.meters.map((m) => (
                <li key={m.id} className="grid gap-1">
                  <label htmlFor={`reading_${m.id}`} className="text-sm font-semibold">
                    {METER_KIND[m.kind]}
                    {m.meterNumber ? <span className="font-normal text-ink/60"> · mittari {m.meterNumber}</span> : null}
                  </label>
                  {m.openReading?.source === "staff" ? (
                    <p className="text-sm">Isännöitsijä on kirjannut lukeman {trimDecimal(m.openReading.value)} m³.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <ReadingInput
                        meterId={m.id}
                        previous={m.lastReading?.value ?? null}
                        id={`reading_${m.id}`}
                        name={`reading_${m.id}`}
                        inputMode="decimal"
                        defaultValue={m.openReading ? trimDecimal(m.openReading.value) : ""}
                        className="w-36"
                      />
                      <span className="text-sm text-ink/60">m³</span>
                    </div>
                  )}
                  {m.lastReading ? (
                    <p className="text-xs text-ink/55">
                      Edellinen lukema {trimDecimal(m.lastReading.value)} m³ ({formatDate(m.lastReading.on)})
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <ReadingConfirm />
            {unit.meters.some((m) => m.openReading?.source !== "staff") ? (
              <div>
                <Button variant="secondary">{unit.meters.some((m) => m.openReading?.source === "portal") ? "Päivitä lukemat" : "Lähetä lukemat"}</Button>
              </div>
            ) : null}
          </ReadingChecks>
        </form>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {unit.meters.map((m) => (
            <li key={m.id} className="flex justify-between gap-3 py-2">
              <span>
                {METER_KIND[m.kind]}
                {m.meterNumber ? <span className="text-ink/60"> · {m.meterNumber}</span> : null}
              </span>
              <span className="tabular text-ink/70">{m.lastReading ? `${trimDecimal(m.lastReading.value)} m³ (${formatDate(m.lastReading.on)})` : "–"}</span>
            </li>
          ))}
        </ul>
      )}
      {unit.advance ? (
        <p className="mt-3 text-sm">Vesiennakko {formatEur(unit.advance.monthlyEur)}/kk. Ennakot hyvitetään vesilaskussa todellisen kulutuksen mukaan.</p>
      ) : null}
    </div>
  );
}
