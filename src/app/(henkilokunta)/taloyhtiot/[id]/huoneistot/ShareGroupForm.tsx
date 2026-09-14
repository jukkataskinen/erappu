import { Button, Field, Input, Panel, Select } from "@/components/ui";
import { saveShareGroup } from "../../actions";
import { formatRanges, type ShareRange } from "@/lib/registry/share-ranges";

export interface ShareGroupFormValues {
  id?: string;
  unit_label?: string;
  kind?: string;
  layout?: string | null;
  floor?: string | null;
  area_m2?: string | null;
  intended_use?: string | null;
  building_id?: string | null;
  is_rented?: boolean;
  ranges?: ShareRange[];
}

export function ShareGroupForm({ companyId, values, buildings, readOnly }: { companyId: string; values?: ShareGroupFormValues; buildings: { id: string; label: string | null }[]; readOnly?: boolean }) {
  const v = values ?? {};
  return (
    <form action={saveShareGroup}>
      <Panel>
        <input type="hidden" name="company_id" value={companyId} />
        {v.id ? <input type="hidden" name="id" value={v.id} /> : null}
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <Field label="Huoneiston tunnus" htmlFor="unit_label" hint="Esim. A 1, B 12 tai AT3">
            <Input id="unit_label" name="unit_label" required defaultValue={v.unit_label} />
          </Field>
          <Field label="Tyyppi" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue={v.kind ?? "apartment"}>
              <option value="apartment">Asuinhuoneisto</option>
              <option value="commercial">Liikehuoneisto</option>
              <option value="parking">Autopaikka</option>
              <option value="garage">Autotalli</option>
              <option value="storage">Varasto</option>
              <option value="other">Muu</option>
            </Select>
          </Field>
          <Field label="Osakkeiden numerot" htmlFor="ranges" hint="Esim. 1-143. Useampi väli pilkulla erotettuna.">
            <Input id="ranges" name="ranges" defaultValue={v.ranges ? formatRanges(v.ranges).replace(/–/g, "-") : ""} />
          </Field>
          <Field label="Pinta-ala (m²)" htmlFor="area_m2">
            <Input id="area_m2" name="area_m2" inputMode="decimal" defaultValue={v.area_m2 ?? ""} />
          </Field>
          <Field label="Huoneistotyyppi" htmlFor="layout" hint="Esim. 2h+k+s">
            <Input id="layout" name="layout" defaultValue={v.layout ?? ""} />
          </Field>
          <Field label="Kerros" htmlFor="floor">
            <Input id="floor" name="floor" defaultValue={v.floor ?? ""} />
          </Field>
          <Field label="Käyttötarkoitus (yhtiöjärjestys)" htmlFor="intended_use">
            <Input id="intended_use" name="intended_use" defaultValue={v.intended_use ?? ""} />
          </Field>
          <Field label="Rakennus" htmlFor="building_id">
            <Select id="building_id" name="building_id" defaultValue={v.building_id ?? ""}>
              <option value="">Ei valittu</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label ?? "Rakennus"}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" name="is_rented" defaultChecked={v.is_rented} className="size-5" />
            Huoneisto on vuokrattu
          </label>
        </fieldset>
        {!readOnly ? (
          <div className="mt-5">
            <Button>{v.id ? "Tallenna muutokset" : "Lisää huoneisto"}</Button>
          </div>
        ) : null}
      </Panel>
    </form>
  );
}
