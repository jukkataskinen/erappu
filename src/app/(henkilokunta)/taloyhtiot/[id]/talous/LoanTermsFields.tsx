import { Field, Input, Select } from "@/components/ui";
import { decimalInput, LOAN_TYPE } from "@/lib/finance/labels";

export interface LoanTermsValues {
  loan_type?: string | null;
  reference_rate?: string | null;
  margin_percent?: string | null;
  interest_percent?: string | null;
  undrawn_estimated_on?: string | null;
}

/** Lainan ehdot isännöitsijäntodistusta varten; sama kenttäryhmä uuden lainan ja lainasivun lomakkeessa. */
export function LoanTermsFields({ values, disabled }: { values?: LoanTermsValues; disabled?: boolean }) {
  const v = values ?? {};
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Lainatyyppi" htmlFor="loan_type">
        <Select id="loan_type" name="loan_type" defaultValue={v.loan_type ?? ""} disabled={disabled}>
          <option value="">Ei valittu</option>
          {Object.entries(LOAN_TYPE).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Viitekorko" htmlFor="reference_rate">
        <Input id="reference_rate" name="reference_rate" defaultValue={v.reference_rate ?? ""} placeholder="Euribor 12 kk" disabled={disabled} />
      </Field>
      <Field label="Marginaali (%)" htmlFor="margin_percent">
        <Input id="margin_percent" name="margin_percent" inputMode="decimal" defaultValue={decimalInput(v.margin_percent)} disabled={disabled} />
      </Field>
      <Field label="Korko (%)" htmlFor="interest_percent" hint="Kiinteä tai viimeksi tiedossa oleva kokonaiskorko">
        <Input id="interest_percent" name="interest_percent" inputMode="decimal" defaultValue={decimalInput(v.interest_percent)} disabled={disabled} />
      </Field>
      <Field label="Nostamaton osa nostetaan arviolta" htmlFor="undrawn_estimated_on">
        <Input id="undrawn_estimated_on" name="undrawn_estimated_on" type="date" defaultValue={v.undrawn_estimated_on ?? ""} disabled={disabled} />
      </Field>
    </div>
  );
}
