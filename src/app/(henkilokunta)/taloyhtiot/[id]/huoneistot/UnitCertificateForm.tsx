import { Button, Field, Input, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { toIsoDate } from "@/lib/format";
import { saveUnitCertificateInfo } from "../../actions";

export interface UnitCertificateValues {
  certificate_notes: string | null;
  company_possession: boolean;
  company_possession_decided_on: string | Date | null;
  company_possession_ends_on: string | Date | null;
  company_rented: boolean;
  widow_right: boolean | null;
  spouses_common_home: string | null;
  other_restrictions: string | null;
}

/** Huoneiston isännöitsijäntodistuksen tiedot: hallinta, rajoitukset ja lisätiedot (VNa 365/2010 4 § 6, 7 ja 13 kohta). */
export function UnitCertificateForm({ companyId, groupId, values, readOnly }: { companyId: string; groupId: string; values: UnitCertificateValues; readOnly?: boolean }) {
  const v = values;
  const tri = (b: boolean | null) => (b === true ? "yes" : b === false ? "no" : "");
  return (
    <Panel>
      <SectionTitle>Isännöitsijäntodistuksen tiedot</SectionTitle>
      <form action={saveUnitCertificateInfo}>
        <input type="hidden" name="company_id" value={companyId} />
        <input type="hidden" name="share_group_id" value={groupId} />
        <fieldset disabled={readOnly} className="grid gap-4">
          <div className="grid gap-3 rounded-xl border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="company_possession" defaultChecked={v.company_possession} className="size-4" />
              Huoneisto on otettu yhtiön hallintaan (AOYL 8 luku)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Yhtiökokouksen päätös" htmlFor="company_possession_decided_on">
                <Input id="company_possession_decided_on" name="company_possession_decided_on" type="date" defaultValue={toIsoDate(v.company_possession_decided_on)} />
              </Field>
              <Field label="Hallinta päättyy" htmlFor="company_possession_ends_on">
                <Input id="company_possession_ends_on" name="company_possession_ends_on" type="date" defaultValue={toIsoDate(v.company_possession_ends_on)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="company_rented" defaultChecked={v.company_rented} className="size-4" />
              Yhtiö on vuokrannut huoneiston
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lesken hallintaoikeus" htmlFor="widow_right">
              <Select id="widow_right" name="widow_right" defaultValue={tri(v.widow_right)}>
                <option value="">Ei tiedossa</option>
                <option value="yes">Kyllä</option>
                <option value="no">Ei</option>
              </Select>
            </Field>
            <Field label="Puolisoiden yhteinen koti" htmlFor="spouses_common_home">
              <Select id="spouses_common_home" name="spouses_common_home" defaultValue={v.spouses_common_home ?? ""}>
                <option value="">Ei kirjattu</option>
                <option value="yes">Kyllä</option>
                <option value="no">Ei</option>
                <option value="unknown">Ei tiedossa</option>
              </Select>
            </Field>
          </div>
          <Field label="Muut käyttö- ja luovutusrajoitukset" htmlFor="other_restrictions">
            <Textarea id="other_restrictions" name="other_restrictions" rows={2} maxLength={2000} defaultValue={v.other_restrictions ?? ""} />
          </Field>
          <Field label="Huoneiston lisätiedot" htmlFor="unit_certificate_notes" hint="Yhtiön tiedossa olevat olennaiset viat ja puutteet sekä muut huoneistoa koskevat tiedot.">
            <Textarea id="unit_certificate_notes" name="certificate_notes" rows={3} maxLength={4000} defaultValue={v.certificate_notes ?? ""} />
          </Field>
        </fieldset>
        {!readOnly ? (
          <div className="mt-4">
            <Button variant="secondary">Tallenna todistuksen tiedot</Button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
