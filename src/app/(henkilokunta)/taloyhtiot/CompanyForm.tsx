import { Button, Field, Input, Panel, Select, SectionTitle } from "@/components/ui";
import type { Company } from "@/lib/registry/queries";
import { REDEMPTION_CLAUSE } from "@/lib/registry/labels";

export function CompanyForm({
  action,
  company,
  staff,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  company?: Company | null;
  staff: { id: string; name: string }[];
  submitLabel: string;
}) {
  const c = company;
  return (
    <form action={action} className="grid gap-6">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <Panel>
        <SectionTitle>Perustiedot</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nimi" htmlFor="name">
            <Input id="name" name="name" required defaultValue={c?.name} />
          </Field>
          <Field label="Y-tunnus" htmlFor="business_id">
            <Input id="business_id" name="business_id" required defaultValue={c?.business_id} placeholder="1234567-8" />
          </Field>
          <Field label="Yhtiömuoto" htmlFor="company_form">
            <Select id="company_form" name="company_form" defaultValue={c?.company_form ?? "asunto_oy"}>
              <option value="asunto_oy">Asunto-osakeyhtiö</option>
              <option value="koy">Keskinäinen kiinteistöosakeyhtiö</option>
              <option value="other">Muu</option>
            </Select>
          </Field>
          <Field label="Osakkeiden lukumäärä" htmlFor="total_shares" hint="Yhtiöjärjestyksen mukaan. Huoneistojen osakevälejä verrataan tähän.">
            <Input id="total_shares" name="total_shares" inputMode="numeric" defaultValue={c?.total_shares ?? ""} />
          </Field>
          <Field label="Katuosoite" htmlFor="street_address">
            <Input id="street_address" name="street_address" defaultValue={c?.street_address ?? ""} />
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Postinumero" htmlFor="postal_code">
              <Input id="postal_code" name="postal_code" inputMode="numeric" defaultValue={c?.postal_code ?? ""} />
            </Field>
            <Field label="Postitoimipaikka" htmlFor="city">
              <Input id="city" name="city" defaultValue={c?.city ?? ""} />
            </Field>
          </div>
          <Field label="Yhtiöjärjestyksen päivämäärä" htmlFor="articles_date">
            <Input id="articles_date" name="articles_date" type="date" defaultValue={c?.articles_date?.slice(0, 10) ?? ""} />
          </Field>
          <Field label="Tilikausi alkaa (KK-PP)" htmlFor="fiscal_year_start">
            <Input id="fiscal_year_start" name="fiscal_year_start" defaultValue={c?.fiscal_year_start ?? "01-01"} />
          </Field>
          <Field label="Kaupparekisterimerkintä" htmlFor="commercial_register_note">
            <Input id="commercial_register_note" name="commercial_register_note" defaultValue={c?.commercial_register_note ?? ""} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Isännöinti ja vakuutus</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vastuuisännöitsijä" htmlFor="manager_user_id">
            <Select id="manager_user_id" name="manager_user_id" defaultValue={c?.manager_user_id ?? ""}>
              <option value="">Ei valittu</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Isännöinti alkoi" htmlFor="management_started_on">
            <Input id="management_started_on" name="management_started_on" type="date" defaultValue={c?.management_started_on?.slice(0, 10) ?? ""} />
          </Field>
          <Field label="Vakuutusyhtiö" htmlFor="insurance_company">
            <Input id="insurance_company" name="insurance_company" defaultValue={c?.insurance_company ?? ""} />
          </Field>
          <Field label="Vakuutustyyppi" htmlFor="insurance_type">
            <Input id="insurance_type" name="insurance_type" defaultValue={c?.insurance_type ?? ""} />
          </Field>
          <Field label="Kiinteistönhoito" htmlFor="property_maintenance">
            <Select id="property_maintenance" name="property_maintenance" defaultValue={c?.property_maintenance ?? ""}>
              <option value="">Ei tiedossa</option>
              <option>Huoltoliike</option>
              <option>Talonmies</option>
              <option>Talkoot</option>
            </Select>
          </Field>
          <label className="flex items-center gap-3 self-end pb-2 text-sm font-semibold">
            <input type="checkbox" name="same_charge_basis" defaultChecked={c?.same_charge_basis ?? true} className="size-5" />
            Kaikilla osakkailla sama vastikeperuste
          </label>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Käyttö- ja luovutusrajoitukset</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {REDEMPTION_CLAUSE.map((r) => (
            <label key={r.key} className="flex items-center gap-3 text-sm">
              <input type="checkbox" name={`rc_${r.key}`} defaultChecked={Boolean(c?.redemption_clause?.[r.key])} className="size-5" />
              {r.label}
            </label>
          ))}
        </div>
      </Panel>

      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
