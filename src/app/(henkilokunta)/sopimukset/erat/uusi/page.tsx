import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getTemplate, TEMPLATES } from "@/lib/contract-templates";
import { listActiveCompanies, listBatchItems, listBatches, listProviderOptions } from "@/lib/contract-templates/queries";
import { defaultValues } from "@/lib/contract-templates/render";
import { isoDateHelsinki } from "@/lib/format";
import { FieldInput } from "../FieldInput";
import { createBatchAction } from "../actions";

export const metadata = { title: "Uusi massaluonti" };

type Search = { virhe?: string; pohja?: string; edellinen?: string };

export default async function NewBatchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const template = getTemplate(sp.pohja ?? "") ?? TEMPLATES[0];
  const today = isoDateHelsinki();
  const canWrite = ctx.can("owner", "manager", "assistant");

  const [companies, providers, batches] = await ctx.run((tx) =>
    Promise.all([listActiveCompanies(tx, ctx.org.organizationId), listProviderOptions(tx, ctx.org.organizationId), listBatches(tx, ctx.org.organizationId)]),
  );
  const previousBatches = batches.filter((b) => b.template_key === template.key && b.status !== "cancelled");
  const previousId = previousBatches.some((b) => b.id === sp.edellinen) ? sp.edellinen! : null;
  const previousCompanies = previousId ? new Set((await ctx.run((tx) => listBatchItems(tx, previousId))).map((i) => i.company_id)) : null;
  const defaults = defaultValues(template, "batch", today);
  const sharedFields = template.fields.filter((f) => f.scope === "batch" && f.type !== "provider");

  return (
    <>
      <PageHeader title="Uusi massaluonti" subtitle={template.name} back={{ href: "/sopimukset/erat", label: "Massaluonti" }} />
      <FormError message={sp.virhe} />
      {!canWrite ? (
        <div className="mb-5">
          <Notice tone="warn" title="Roolillasi voit vain katsella sopimuksia" />
        </div>
      ) : null}

      <form action={createBatchAction} className="grid max-w-4xl gap-6">
        <Panel>
          <SectionTitle>1. Pohja ja urakoitsija</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sopimuspohja" htmlFor="template_key" hint={<Link href="/sopimukset/pohjat" className="text-sky">Katso pohjat ja esikatselu</Link>}>
              <Select id="template_key" name="template_key" defaultValue={template.key}>
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Otsikko" htmlFor="title">
              <Input id="title" name="title" required maxLength={200} defaultValue={template.defaultBatchTitle(today)} />
            </Field>
            <Field
              label="Urakoitsija"
              htmlFor="provider_id"
              hint={providers.length === 0 ? <>Palveluntuottajarekisteri on tyhjä. <Link href="/palveluntuottajat" className="text-sky">Lisää urakoitsija</Link> ensin.</> : <Link href="/palveluntuottajat" className="text-sky">Palveluntuottajat</Link>}
            >
              <Select id="provider_id" name="provider_id" defaultValue="" required>
                <option value="">Valitse urakoitsija</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.business_id ? ` (${p.business_id})` : ""}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>2. Yhteiset tiedot</SectionTitle>
          <p className="mb-4 text-sm text-ink/65">Nämä ovat samat kaikille yhtiöille. Hinnat voi muuttaa yhtiökohtaisesti seuraavassa vaiheessa.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {sharedFields.map((f) => (
              <Field
                key={f.key}
                label={f.label + (f.required ? "" : " (valinnainen)")}
                htmlFor={`shared_${f.key}`}
                hint={f.source?.startsWith("provider.") ? "Tyhjä = palveluntuottajarekisterin tieto" : f.hint}
              >
                <FieldInput field={f} id={`shared_${f.key}`} name={`shared[${f.key}]`} value={defaults[f.key]} />
              </Field>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>3. Yhtiöt</SectionTitle>
          {previousBatches.length > 0 ? (
            <p className="mb-3 text-sm">
              Pikavalinta: samat kuin erässä{" "}
              {previousBatches.slice(0, 3).map((b, i) => (
                <span key={b.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/sopimukset/erat/uusi?pohja=${template.key}&edellinen=${b.id}`} className="font-semibold text-sky">{b.title}</Link>
                </span>
              ))}
              {previousId ? <> · <Link href={`/sopimukset/erat/uusi?pohja=${template.key}`} className="text-sky">kaikki yhtiöt</Link></> : null}
            </p>
          ) : null}
          {companies.length === 0 ? (
            <p className="text-sm text-ink/65">Organisaatiossa ei ole aktiivisia taloyhtiöitä.</p>
          ) : (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Valitse yhtiöt</legend>
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
                  <input type="checkbox" name="company_ids" value={c.id} defaultChecked={previousCompanies ? previousCompanies.has(c.id) : true} className="h-5 w-5" />
                  <span>
                    <span className="font-semibold">{c.name}</span>
                    {c.city ? <span className="block text-xs text-ink/55">{c.city}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="mt-3 text-xs text-ink/55">Tilaajan edustaja (hallituksen puheenjohtaja tai vastuuisännöitsijä) ja kohteen osoite esitäytetään rekisteristä.</p>
        </Panel>

        {canWrite ? (
          <div>
            <Button>Luo erä ja jatka yhtiökohtaisiin tietoihin</Button>
          </div>
        ) : null}
      </form>
    </>
  );
}
