import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { CONTRACT_CATEGORIES, CONTRACT_CATEGORY_LABEL, CONTRACT_STATUS_LABEL } from "@/lib/contracts/labels";
import type { ContractRow } from "@/lib/contracts/queries";
import { createContractAction, updateContractAction } from "./actions";

export function ContractForm({
  contract, companies, documents, defaultCompanyId, readOnly,
}: {
  contract?: ContractRow | null;
  companies: { id: string; name: string }[];
  documents: { id: string; title: string; company_name: string }[];
  defaultCompanyId?: string;
  readOnly?: boolean;
}) {
  const c = contract;
  return (
    <form action={c ? updateContractAction : createContractAction}>
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <Panel>
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <Field label="Taloyhtiö" htmlFor="company_id">
            <Select id="company_id" name="company_id" required defaultValue={c?.company_id ?? defaultCompanyId ?? ""}>
              <option value="" disabled>Valitse yhtiö</option>
              {companies.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Luokka" htmlFor="category">
            <Select id="category" name="category" defaultValue={c?.category ?? "other"}>
              {CONTRACT_CATEGORIES.map((k) => (
                <option key={k} value={k}>{CONTRACT_CATEGORY_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Vastapuoli" htmlFor="counterparty" hint="Yritys, jonka kanssa sopimus on tehty.">
              <Input id="counterparty" name="counterparty" required maxLength={200} defaultValue={c?.counterparty} />
            </Field>
          </div>
          <Field label="Alkaa" htmlFor="starts_on">
            <Input id="starts_on" name="starts_on" type="date" defaultValue={c?.starts_on ?? ""} />
          </Field>
          <Field label="Päättyy" htmlFor="ends_on" hint="Jätä tyhjäksi, jos sopimus on voimassa toistaiseksi.">
            <Input id="ends_on" name="ends_on" type="date" defaultValue={c?.ends_on ?? ""} />
          </Field>
          <Field label="Irtisanomisaika (kk)" htmlFor="notice_months" hint="Irtisanomisen viimeinen päivä lasketaan päättymispäivästä.">
            <Input id="notice_months" name="notice_months" type="number" min={0} max={60} defaultValue={c?.notice_months ?? ""} />
          </Field>
          <Field label="Vuosikustannus (€)" htmlFor="annual_cost_eur">
            <Input id="annual_cost_eur" name="annual_cost_eur" inputMode="decimal" defaultValue={c?.annual_cost_eur?.replace(".", ",") ?? ""} />
          </Field>
          <Field label="Muistutus" htmlFor="reminder_on" hint="Tyhjä = 30 päivää ennen irtisanomisen viimeistä päivää (tai päättymistä).">
            <Input id="reminder_on" name="reminder_on" type="date" defaultValue={c?.reminder_on ?? ""} />
          </Field>
          <Field label="Tila" htmlFor="status">
            <Select id="status" name="status" defaultValue={c?.status ?? "active"}>
              {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Sopimusasiakirja" htmlFor="document_id" hint="Dokumenttipankin sopimus- tai vakuutusasiakirja samasta yhtiöstä.">
              <Select id="document_id" name="document_id" defaultValue={c?.document_id ?? ""}>
                <option value="">Ei liitettyä asiakirjaa</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>{d.company_name}: {d.title}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Kuvaus" htmlFor="description" hint="Sopimuksen sisältö, hinnoitteluperuste, yhteyshenkilö.">
              <Textarea id="description" name="description" maxLength={4000} defaultValue={c?.description ?? ""} />
            </Field>
          </div>
        </fieldset>
        {!readOnly ? (
          <div className="mt-5">
            <Button>{c ? "Tallenna muutokset" : "Lisää sopimus"}</Button>
          </div>
        ) : null}
      </Panel>
    </form>
  );
}
