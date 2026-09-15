import { Field, Input, Select } from "@/components/ui";
import { PURPOSE_LABEL } from "@/lib/certificates/content";

/** Todistuksen käyttötarkoitus: henkilökunnan ja julkisen tilauslomakkeen yhteinen kenttäpari. */
export function PurposeFields({ defaultPurpose, defaultText }: { defaultPurpose?: string | null; defaultText?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Käyttötarkoitus" htmlFor="purpose">
        <Select id="purpose" name="purpose" defaultValue={defaultPurpose ?? ""}>
          <option value="">Ei ilmoitettu</option>
          {Object.entries(PURPOSE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Muu, mikä" htmlFor="purpose_text">
        <Input id="purpose_text" name="purpose_text" maxLength={200} defaultValue={defaultText ?? ""} />
      </Field>
    </div>
  );
}
