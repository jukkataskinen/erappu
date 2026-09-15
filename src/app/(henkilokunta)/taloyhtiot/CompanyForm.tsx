import { Button, Field, Input, Panel, Select, SectionTitle, Textarea } from "@/components/ui";
import type { Company } from "@/lib/registry/queries";
import { REDEMPTION_CLAUSE } from "@/lib/registry/labels";
import { toIsoDate } from "@/lib/format";

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
            <Input id="articles_date" name="articles_date" type="date" defaultValue={toIsoDate(c?.articles_date)} />
          </Field>
          <Field label="Tilikausi alkaa (KK-PP)" htmlFor="fiscal_year_start">
            <Input id="fiscal_year_start" name="fiscal_year_start" defaultValue={c?.fiscal_year_start ?? "01-01"} />
          </Field>
          <Field label="Kaupparekisterimerkintä" htmlFor="commercial_register_note">
            <Input id="commercial_register_note" name="commercial_register_note" defaultValue={c?.commercial_register_note ?? ""} />
          </Field>
          <Field label="Rekisteröintipäivä" htmlFor="registered_on" hint="Kaupparekisteriin merkitsemisen päivä (isännöitsijäntodistus)">
            <Input id="registered_on" name="registered_on" type="date" defaultValue={toIsoDate(c?.registered_on)} />
          </Field>
          <Field label="Osakeluettelo siirretty HTJ:hin" htmlFor="htj_register_transferred_on">
            <Input id="htj_register_transferred_on" name="htj_register_transferred_on" type="date" defaultValue={toIsoDate(c?.htj_register_transferred_on)} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Isännöitsijäntodistuksen lisätiedot</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Arvonlisäverovelvollinen" htmlFor="vat_registered">
            <Select id="vat_registered" name="vat_registered" defaultValue={c?.vat_registered === true ? "yes" : c?.vat_registered === false ? "no" : ""}>
              <option value="">Ei kirjattu</option>
              <option value="yes">Kyllä</option>
              <option value="no">Ei</option>
            </Select>
          </Field>
          <Field label="ALV-rekisteröinnin tarkennus" htmlFor="vat_note" hint="esim. liiketilat 1.1.2020 alkaen">
            <Input id="vat_note" name="vat_note" defaultValue={c?.vat_note ?? ""} />
          </Field>
          <Field label="Vastikkeen suuruuden ja maksutavan määrää" htmlFor="charges_decided_by" hint="Yhtiöjärjestyksen mukaan">
            <Input id="charges_decided_by" name="charges_decided_by" defaultValue={c?.charges_decided_by ?? ""} placeholder="Yhtiökokous" />
          </Field>
          <Field label="Kunnossapitovastuu tai muutostyöt yhtiöjärjestyksessä" htmlFor="articles_maintenance_clause" hint="Tyhjä = ei laista poikkeavia määräyksiä">
            <Input id="articles_maintenance_clause" name="articles_maintenance_clause" defaultValue={c?.articles_maintenance_clause ?? ""} />
          </Field>
          <Field label="Osakeanti- tai optiovaltuutus" htmlFor="share_issue_authorization">
            <Input id="share_issue_authorization" name="share_issue_authorization" defaultValue={c?.share_issue_authorization ?? ""} />
          </Field>
          <Field label="Kanne yhtiöjärjestyksen muuttamiseksi (AOYL 6:36 §)" htmlFor="articles_lawsuit">
            <Input id="articles_lawsuit" name="articles_lawsuit" defaultValue={c?.articles_lawsuit ?? ""} />
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Yhtiön lisätiedot"
            htmlFor="certificate_notes"
            hint="Tulostuu jokaiseen yhtiön todistukseen, esim. vireillä oleva yhtiöjärjestyksen muutos tai muu yhtiön taloudelliseen tilaan olennaisesti vaikuttava seikka."
          >
            <Textarea id="certificate_notes" name="certificate_notes" rows={4} maxLength={4000} defaultValue={c?.certificate_notes ?? ""} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Autopaikat</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Hallipaikat" htmlFor="parking_hall_spaces">
            <Input id="parking_hall_spaces" name="parking_hall_spaces" inputMode="numeric" defaultValue={c?.parking_hall_spaces ?? ""} />
          </Field>
          <Field label="Muut paikat" htmlFor="parking_other_spaces" hint="Piha-, katos- ja lämpöpaikat">
            <Input id="parking_other_spaces" name="parking_other_spaces" inputMode="numeric" defaultValue={c?.parking_other_spaces ?? ""} />
          </Field>
          <Field label="Yhtiön hallinnassa" htmlFor="parking_company_spaces">
            <Input id="parking_company_spaces" name="parking_company_spaces" inputMode="numeric" defaultValue={c?.parking_company_spaces ?? ""} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Jakosäännöt" htmlFor="parking_allocation_rules" hint="esim. hallituksen päätöksellä vuokrattavat paikat, jonotus">
            <Textarea id="parking_allocation_rules" name="parking_allocation_rules" rows={2} maxLength={2000} defaultValue={c?.parking_allocation_rules ?? ""} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Isännöinti</SectionTitle>
        <p className="mb-3 text-sm text-ink/60">Vakuutukset kirjataan luettelona yhtiön perustiedoissa.</p>
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
            <Input id="management_started_on" name="management_started_on" type="date" defaultValue={toIsoDate(c?.management_started_on)} />
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
