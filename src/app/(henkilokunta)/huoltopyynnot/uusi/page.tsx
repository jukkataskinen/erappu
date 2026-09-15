import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listStaff } from "@/lib/registry/queries";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { PhotoInput } from "@/lib/service-requests/components/PhotoInput";
import { CompanyUnitSelect } from "@/lib/service-requests/components/CompanyUnitSelect";
import { CATEGORIES, CATEGORY_LABEL, URGENCIES, URGENCY_LABEL } from "@/lib/service-requests/labels";
import { listCompanyOptions, listShareGroupOptions } from "@/lib/service-requests/queries";
import { createStaffRequest } from "../actions";

export const metadata = { title: "Uusi huoltopyyntö" };

export default async function NewServiceRequestPage({ searchParams }: { searchParams: Promise<{ virhe?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, yhtio } = await searchParams;
  const canWrite = ctx.can("owner", "manager", "assistant");
  const [companies, groups, staff] = await ctx.run((tx) =>
    Promise.all([listCompanyOptions(tx, ctx.org.organizationId), listShareGroupOptions(tx, ctx.org.organizationId), listStaff(tx, ctx.org.organizationId)]),
  );
  const selectedCompany = companies.some((c) => c.id === yhtio) ? yhtio : undefined;

  return (
    <>
      <PageHeader title="Uusi huoltopyyntö" back={{ href: "/huoltopyynnot", label: "Huoltopyynnöt" }} />
      <FormError message={virhe} />
      {!canWrite ? (
        <Notice tone="warn" title="Ei oikeutta">
          Roolillasi voi lukea pyyntöjä ja kirjata kustannuksia, mutta ei luoda uusia.
        </Notice>
      ) : (
        <PhotoForm action={createStaffRequest} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Panel className="grid content-start gap-4">
            <SectionTitle>Vika</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <CompanyUnitSelect companies={companies} groups={groups} defaultCompanyId={selectedCompany} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tila tai paikka" htmlFor="unit_text" hint="Esim. sauna, pesutupa, piha">
                <Input id="unit_text" name="unit_text" maxLength={60} />
              </Field>
            </div>
            <Field label="Otsikko" htmlFor="title">
              <Input id="title" name="title" required maxLength={200} placeholder="Esim. keittiön hana vuotaa" />
            </Field>
            <Field label="Kuvaus" htmlFor="description">
              <Textarea id="description" name="description" maxLength={5000} rows={5} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Aihe" htmlFor="category">
                <Select id="category" name="category" defaultValue="other">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kiireellisyys" htmlFor="urgency">
                <Select id="urgency" name="urgency" defaultValue="normal">
                  {URGENCIES.map((u) => (
                    <option key={u} value={u}>
                      {URGENCY_LABEL[u]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="may_use_master_key" className="h-5 w-5" /> Huoneistoon saa mennä yleisavaimella
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="has_pets" className="h-5 w-5" /> Huoneistossa on lemmikkejä
            </label>
            <PhotoInput />
            <Field label="Kuvien näkyvyys" htmlFor="photo_visibility">
              <Select id="photo_visibility" name="photo_visibility" defaultValue="reporter">
                <option value="reporter">Ilmoittaja, hallitus ja palveluntuottaja</option>
                <option value="internal">Vain henkilökunta</option>
              </Select>
            </Field>
          </Panel>

          <div className="grid content-start gap-6">
            <Panel className="grid gap-4">
              <SectionTitle>Ilmoittaja</SectionTitle>
              <Field label="Nimi" htmlFor="reporter_name">
                <Input id="reporter_name" name="reporter_name" maxLength={200} />
              </Field>
              <Field label="Puhelin" htmlFor="reporter_phone" hint="Näytetään palveluntuottajalle tehtävälinkissä">
                <Input id="reporter_phone" name="reporter_phone" type="tel" maxLength={40} />
              </Field>
              <Field label="Sähköposti" htmlFor="reporter_email" hint="Ilmoittaja saa tiedon tilamuutoksista">
                <Input id="reporter_email" name="reporter_email" type="email" maxLength={254} />
              </Field>
            </Panel>
            <Panel className="grid gap-4">
              <SectionTitle>Käsittely</SectionTitle>
              <Field label="Vastuuhenkilö" htmlFor="assignee_user_id">
                <Select id="assignee_user_id" name="assignee_user_id" defaultValue={ctx.user.id}>
                  <option value="">Ei vastuuhenkilöä</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Määräaika" htmlFor="due_on">
                <Input id="due_on" name="due_on" type="date" />
              </Field>
              <p className="text-xs text-ink/55">Yhtiön oletuspalveluntuottaja liitetään pyyntöön automaattisesti. Tilauksen lähetät pyynnön sivulta.</p>
              <div>
                <Button type="submit">Tallenna pyyntö</Button>
              </div>
            </Panel>
          </div>
        </PhotoForm>
      )}
    </>
  );
}
