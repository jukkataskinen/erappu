import { Button, DefinitionList, Field, Input, Panel, SectionTitle } from "@/components/ui";
import { formatEur } from "@/lib/format";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { getOrganization } from "@/lib/settings/organization";
import { saveOrganization } from "../actions";
import { SettingsHeader } from "../SettingsHeader";

export const metadata = { title: "Asetukset: organisaatio" };

export default async function OrganizationSettingsPage({ searchParams }: { searchParams: Promise<{ virhe?: string; ok?: string }> }) {
  const ctx = await requireSettingsAccess();
  const { virhe, ok } = await searchParams;
  const org = await ctx.run((tx) => getOrganization(tx, ctx.org.organizationId));
  const contact = org?.settings.contact ?? {};
  const prices = org?.settings.certificate_prices ?? {};
  const letters = org?.settings.letter_prices ?? {};
  const canEdit = ctx.can("owner");

  return (
    <>
      <SettingsHeader active="organisaatio" organizationName={ctx.org.organizationName} virhe={virhe} ok={ok} />
      {canEdit ? (
        <Panel>
          <form action={saveOrganization} className="grid gap-6">
            <div>
              <SectionTitle>Perustiedot</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nimi" htmlFor="name">
                  <Input id="name" name="name" defaultValue={org?.name ?? ""} required />
                </Field>
                <Field label="Y-tunnus" htmlFor="business_id" hint="Muodossa 1234567-8">
                  <Input id="business_id" name="business_id" defaultValue={org?.business_id ?? ""} />
                </Field>
              </div>
            </div>
            <div>
              <SectionTitle>Yhteystiedot</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Puhelin" htmlFor="phone">
                  <Input id="phone" name="phone" type="tel" defaultValue={contact.phone ?? ""} />
                </Field>
                <Field label="Sähköposti" htmlFor="email">
                  <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
                </Field>
                <Field label="Katuosoite" htmlFor="street_address">
                  <Input id="street_address" name="street_address" defaultValue={contact.street_address ?? ""} />
                </Field>
                <div className="grid grid-cols-[8rem_1fr] gap-3">
                  <Field label="Postinumero" htmlFor="postal_code">
                    <Input id="postal_code" name="postal_code" inputMode="numeric" defaultValue={contact.postal_code ?? ""} />
                  </Field>
                  <Field label="Postitoimipaikka" htmlFor="city">
                    <Input id="city" name="city" defaultValue={contact.city ?? ""} />
                  </Field>
                </div>
              </div>
            </div>
            <div>
              <SectionTitle>Isännöitsijäntodistuksen oletushinnat</SectionTitle>
              <p className="mb-3 text-sm text-ink/60">
                eRapussa ei ole valmista hinnastoa: hinnan päättää isännöinti itse tai yhdessä hallituksen kanssa. Tyhjä kenttä = tilausta ei hinnoitella, jolloin
                hinta sovitaan laskutuksessa.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Todistus (€, sis. alv)" htmlFor="certificate_standard_eur">
                  <Input id="certificate_standard_eur" name="certificate_standard_eur" inputMode="decimal" defaultValue={prices.standard_eur ?? ""} />
                </Field>
                <Field label="Pikatoimitus (€, sis. alv)" htmlFor="certificate_express_eur">
                  <Input id="certificate_express_eur" name="certificate_express_eur" inputMode="decimal" defaultValue={prices.express_eur ?? ""} />
                </Field>
                <Field label="Todistus liitteineen (€, sis. alv)" htmlFor="certificate_with_attachments_eur" hint="Tyhjä = sama kuin todistus. Pikatoimitus lisää saman lisähinnan.">
                  <Input id="certificate_with_attachments_eur" name="certificate_with_attachments_eur" inputMode="decimal" defaultValue={prices.with_attachments_eur ?? ""} />
                </Field>
              </div>
            </div>
            <div>
              <SectionTitle>Kirjeiden hinnat taloyhtiöille</SectionTitle>
              <p className="mb-3 text-sm text-ink/60">
                Postitukset (paperikutsut ja tiedotteet Postitan kautta) laskutetaan taloyhtiöltä näillä hinnoilla. Hinnat ovat verottomia; arvonlisävero lisätään
                laskulle. Hinta lukitaan postitukselle, kun postitus vahvistetaan. Ilman kirjehintaa postitusta ei voi vahvistaa. Postitan oma hinta on 2,34 € (2. lk)
                tai 3,27 € (1. lk) ja lisäsivu 0,16 €.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kirje 2. luokka (€, alv 0)" htmlFor="letter_class2_eur">
                  <Input id="letter_class2_eur" name="letter_class2_eur" inputMode="decimal" defaultValue={letters.class2_eur ?? ""} />
                </Field>
                <Field label="Kirje 1. luokka (€, alv 0)" htmlFor="letter_class1_eur">
                  <Input id="letter_class1_eur" name="letter_class1_eur" inputMode="decimal" defaultValue={letters.class1_eur ?? ""} />
                </Field>
                <Field label="Lisäsivu (€, alv 0)" htmlFor="letter_extra_page_eur" hint="Ensimmäisen sivun jälkeen. Tyhjä = ei veloitusta.">
                  <Input id="letter_extra_page_eur" name="letter_extra_page_eur" inputMode="decimal" defaultValue={letters.extra_page_eur ?? ""} />
                </Field>
                <Field label="Arvonlisävero (%)" htmlFor="letter_vat_percent" hint="Tyhjä = 25,5 %.">
                  <Input id="letter_vat_percent" name="letter_vat_percent" inputMode="decimal" defaultValue={letters.vat_percent ?? ""} />
                </Field>
              </div>
            </div>
            <div>
              <Button>Tallenna</Button>
            </div>
          </form>
        </Panel>
      ) : (
        <Panel>
          <DefinitionList
            items={[
              { label: "Nimi", value: org?.name },
              { label: "Y-tunnus", value: org?.business_id },
              { label: "Puhelin", value: contact.phone },
              { label: "Sähköposti", value: contact.email },
              { label: "Osoite", value: [contact.street_address, [contact.postal_code, contact.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null },
              { label: "Todistus", value: prices.standard_eur != null ? formatEur(prices.standard_eur) : null },
              { label: "Pikatoimitus", value: prices.express_eur != null ? formatEur(prices.express_eur) : null },
              {
                label: "Todistus liitteineen",
                value: prices.with_attachments_eur != null ? formatEur(prices.with_attachments_eur) : prices.standard_eur != null ? "Sama kuin todistus" : null,
              },
              { label: "Kirje 2. luokka (alv 0)", value: letters.class2_eur != null ? formatEur(letters.class2_eur) : null },
              { label: "Kirje 1. luokka (alv 0)", value: letters.class1_eur != null ? formatEur(letters.class1_eur) : null },
              { label: "Lisäsivu (alv 0)", value: letters.extra_page_eur != null ? formatEur(letters.extra_page_eur) : null },
            ]}
          />
          <p className="mt-4 text-sm text-ink/60">Organisaation tietoja muuttaa pääkäyttäjä.</p>
        </Panel>
      )}
    </>
  );
}
