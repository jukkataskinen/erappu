import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { ResourceRow } from "@/lib/bookings/queries";
import { WEEKDAY_LABEL, WEEKDAYS } from "@/lib/bookings/slots";
import { saveResourceAction } from "./actions";

export function ResourceForm({
  resource,
  companies,
  defaultCompanyId,
  readOnly,
  back,
}: {
  resource?: ResourceRow | null;
  companies?: { id: string; name: string }[];
  defaultCompanyId?: string;
  readOnly?: boolean;
  back?: string;
}) {
  const r = resource;
  return (
    <form action={saveResourceAction}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <fieldset disabled={readOnly} className="grid gap-4">
        {!r && companies ? (
          <Field label="Taloyhtiö" htmlFor="company_id">
            <Select id="company_id" name="company_id" required defaultValue={defaultCompanyId ?? ""}>
              <option value="" disabled>Valitse yhtiö</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Kohde" htmlFor="name" hint="Esim. Sauna, Pesutupa, Kerhohuone">
          <Input id="name" name="name" required maxLength={100} defaultValue={r?.name} />
        </Field>
        <Field label="Kuvaus" htmlFor="description" hint="Näkyy asukkaille: sijainti, avain, säännöt.">
          <Textarea id="description" name="description" maxLength={2000} defaultValue={r?.description ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vuoron pituus (min)" htmlFor="slot_minutes">
            <Input id="slot_minutes" name="slot_minutes" type="number" min={15} max={1440} step={15} required defaultValue={r?.slot_minutes ?? 60} />
          </Field>
          <Field label="Kiintiö / huoneisto" htmlFor="max_active_bookings_per_unit" hint="Tulevia varauksia enintään. Tyhjä = ei rajaa.">
            <Input id="max_active_bookings_per_unit" name="max_active_bookings_per_unit" type="number" min={1} max={100} defaultValue={r?.max_active_bookings_per_unit ?? ""} />
          </Field>
          <Field label="Hinta (€ / vuoro)" htmlFor="price_eur" hint="Tiedoksi asukkaalle; laskutus talouden kautta.">
            <Input id="price_eur" name="price_eur" inputMode="decimal" defaultValue={r?.price_eur?.replace(".", ",") ?? ""} />
          </Field>
        </div>
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Aukioloajat</legend>
          <p className="mb-3 text-xs text-ink/55">Jätä päivä tyhjäksi, jos kohde on silloin suljettu. Keskiyö lopussa: 00:00.</p>
          <div className="grid gap-2">
            {WEEKDAYS.map((d) => {
              const range = r?.open_hours[d]?.[0];
              return (
                <div key={d} className="grid grid-cols-[6.5rem_1fr_auto_1fr] items-center gap-2">
                  <label htmlFor={`open_${d}_start`} className="text-sm">{WEEKDAY_LABEL[d]}</label>
                  <Input id={`open_${d}_start`} name={`open_${d}_start`} type="time" step={900} defaultValue={range?.[0] ?? ""} aria-label={`${WEEKDAY_LABEL[d]} alkaa`} />
                  <span aria-hidden className="text-ink/50">–</span>
                  <Input id={`open_${d}_end`} name={`open_${d}_end`} type="time" step={900} defaultValue={range?.[1] === "24:00" ? "00:00" : range?.[1] ?? ""} aria-label={`${WEEKDAY_LABEL[d]} päättyy`} />
                </div>
              );
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" name="allow_recurring" defaultChecked={r?.allow_recurring ?? false} className="size-5" />
          Vakiovuorot sallittu (varaus 12 viikoksi kerralla)
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" name="active" defaultChecked={r?.active ?? true} className="size-5" />
          Varattavissa portaalissa
        </label>
      </fieldset>
      {!readOnly ? (
        <div className="mt-5">
          <Button>{r ? "Tallenna muutokset" : "Lisää kohde"}</Button>
        </div>
      ) : null}
    </form>
  );
}
