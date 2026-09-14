import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { AUDIENCE_LABEL, AUDIENCE_ROLES, CHANNEL_LABEL, CHANNELS } from "@/lib/announcements/labels";

export interface AnnouncementFormValues {
  id?: string;
  company_id?: string;
  title?: string;
  body?: string;
  audience_roles?: string[];
  building_ids?: string[] | null;
  channels?: string[];
  valid_until?: string | null;
}

const checkbox = "size-4 accent-[var(--color-ink)]";

/** Tiedotteen lomake. Rakennukset listataan yhtiöittäin; palvelin tarkistaa, että ne kuuluvat valittuun yhtiöön. */
export function AnnouncementForm({
  action,
  companies,
  buildings,
  values = {},
  submitLabel = "Tallenna luonnos",
}: {
  action: (formData: FormData) => Promise<void>;
  companies: { id: string; name: string }[];
  buildings: { id: string; company_id: string; label: string | null }[];
  values?: AnnouncementFormValues;
  submitLabel?: string;
}) {
  const audience = values.audience_roles ?? ["owner", "resident"];
  const channels = values.channels ?? ["portal", "email"];
  const selectedBuildings = new Set(values.building_ids ?? []);
  const buildingsByCompany = companies
    .map((c) => ({ company: c, buildings: buildings.filter((b) => b.company_id === c.id) }))
    .filter((x) => x.buildings.length > 1);

  return (
    <Panel>
      <form action={action} className="grid gap-5">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        <Field label="Taloyhtiö" htmlFor="company_id">
          <Select id="company_id" name="company_id" defaultValue={values.company_id ?? ""} required>
            <option value="" disabled>
              Valitse yhtiö
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Otsikko" htmlFor="title">
          <Input id="title" name="title" defaultValue={values.title} maxLength={200} required />
        </Field>
        <Field label="Teksti" htmlFor="body" hint="Älä kirjoita tiedotteeseen henkilötunnuksia tai yksittäisen asukkaan asioita.">
          <Textarea id="body" name="body" defaultValue={values.body} rows={10} maxLength={20000} required />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Kohderyhmät</legend>
          <div className="flex flex-wrap gap-4">
            {AUDIENCE_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="audience_roles" value={r} defaultChecked={audience.includes(r)} className={checkbox} />
                {AUDIENCE_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>

        {buildingsByCompany.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Rakennukset (valinnainen)</legend>
            <p className="text-xs text-ink/55">Jätä valitsematta, jos tiedote koskee koko yhtiötä. Rajaus koskee osakkaita ja asukkaita, ei hallitusta.</p>
            {buildingsByCompany.map(({ company, buildings: list }) => (
              <div key={company.id} className="flex flex-wrap items-center gap-4">
                <span className="text-sm text-ink/60">{company.name}:</span>
                {list.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="building_ids" value={b.id} defaultChecked={selectedBuildings.has(b.id)} className={checkbox} />
                    {b.label ? `Rakennus ${b.label}` : "Nimetön rakennus"}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Kanavat</legend>
          <div className="flex flex-wrap gap-4">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="channels" value={c} defaultChecked={channels.includes(c)} className={checkbox} />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Voimassa asti" htmlFor="valid_until" hint="Portaalissa tiedote piilotetaan tämän päivän jälkeen.">
          <Input id="valid_until" name="valid_until" type="date" defaultValue={values.valid_until ?? ""} className="sm:max-w-xs" />
        </Field>

        <div>
          <Button>{submitLabel}</Button>
        </div>
      </form>
    </Panel>
  );
}
