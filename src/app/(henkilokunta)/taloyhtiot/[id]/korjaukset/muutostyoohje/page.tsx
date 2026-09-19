import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, SectionTitle, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listRenovationGuides } from "@/lib/maintenance/queries";
import { ASBESTOS_SURVEY_BEFORE_YEAR, GUIDE_WORK_TYPES, RENOVATION_GUIDE_TEMPLATE_APPROVED } from "@/lib/maintenance/renovation-guide";
import { loadGuideCompany } from "@/lib/maintenance/renovation-guide-document";
import { saveRenovationGuide } from "./actions";

export const metadata = { title: "Muutostyöohje" };

const STATE: Record<string, string> = {
  tallennettu: "Tiedot tallennettiin. Esikatsele ohje ennen julkaisua.",
  julkaistu: "Muutostyöohje tallennettiin yhtiön dokumentiksi.",
};

export default async function RenovationGuidePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tila } = await searchParams;
  const company = await loadCompany(ctx, id);
  const [guide, history, current] = await ctx.run(
    async (tx) =>
      [
        await loadGuideCompany(tx, id),
        await tx.query<{ id: string; title: string; visibility: string; created_at: string }>(
          "select id, title, visibility, created_at::text from er_documents where company_id = $1 and category = 'renovation_guide' and share_group_id is null order by created_at desc limit 10",
          [id],
        ),
        await listRenovationGuides(tx, [id]),
      ] as const,
  );
  if (!guide) notFound();
  const s = guide.settings;
  const canWrite = ctx.can("owner", "manager", "assistant");
  const year = guide.oldestBuildingYear;

  return (
    <>
      <CompanyHeader company={company} active="korjaukset" sub="Muutostyöohje" />
      <FormError message={virhe} />
      {tila && STATE[tila] ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title={STATE[tila]} />
        </div>
      ) : null}
      {!RENOVATION_GUIDE_TEMPLATE_APPROVED ? (
        <div className="mb-5">
          <Notice tone="warn" title="Vakiotekstit ovat luonnos">
            Ohjeen yleiset osiot ja työlajikohtaiset vaatimukset odottavat hyväksyntää. Siihen asti PDF:ssä on luonnosmerkintä.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <SectionTitle
            actions={
              <a href={`/taloyhtiot/${id}/korjaukset/muutostyoohje/esikatselu`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-sky">
                Esikatsele PDF
              </a>
            }
          >
            Yhtiökohtaiset tiedot
          </SectionTitle>
          <p className="mb-4 text-sm text-ink/65">
            Ohje kootaan asunto-osakeyhtiölain 5 luvun mukaisista vakioteksteistä, valituista työlajeista ja näistä tiedoista. Esikatselu käyttää tallennettuja tietoja.
            {year !== null && year < ASBESTOS_SURVEY_BEFORE_YEAR ? ` Rakennus on valmistunut ${year}, joten ohjeessa on asbestikartoitusta koskeva osio.` : ""}
            {year === null ? " Rakennuksen valmistumisvuosi puuttuu, joten ohjeessa on varmuuden vuoksi asbestikartoitusta koskeva osio." : ""}
          </p>
          <form action={saveRenovationGuide} className="grid gap-4">
            <input type="hidden" name="company_id" value={id} />
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Työlajikohtaiset osiot</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {GUIDE_WORK_TYPES.map((w) => (
                  <label key={w.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="work_types" value={w.key} defaultChecked={s.workTypes.includes(w.key)} className="mt-0.5 size-4" />
                    {w.title}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Ilmoituksen määräaika" htmlFor="lead_time" hint="Jatkaa lausetta: Tee ilmoitus portaalissa …">
              <Input id="lead_time" name="lead_time" maxLength={200} defaultValue={s.leadTime} />
            </Field>
            <Field label="Työajat" htmlFor="working_hours" hint="Järjestyssääntöjen mukaan">
              <Textarea id="working_hours" name="working_hours" rows={2} maxLength={300} defaultValue={s.workingHours} />
            </Field>
            <Field label="Huollon yhteystiedot" htmlFor="service_contact" hint={guide.defaultServiceContact ? `Tyhjä = ${guide.defaultServiceContact}` : "Näkyy ohjeen yhteystiedoissa"}>
              <Input id="service_contact" name="service_contact" maxLength={300} defaultValue={s.serviceContact} />
            </Field>
            <Field label="Vesikatkot" htmlFor="water_shutoff">
              <Textarea id="water_shutoff" name="water_shutoff" rows={2} maxLength={600} defaultValue={s.waterShutoff} />
            </Field>
            <Field label="Jätteet" htmlFor="waste">
              <Textarea id="waste" name="waste" rows={2} maxLength={600} defaultValue={s.waste} />
            </Field>
            <Field label="Käsittelymaksu" htmlFor="processing_fee" hint="Valinnainen, esim. hallituksen päättämä ilmoituksen käsittelymaksu">
              <Input id="processing_fee" name="processing_fee" maxLength={400} defaultValue={s.processingFee} />
            </Field>
            <Field label="Yhtiön lisäohjeet" htmlFor="extra" hint="Esim. yhtiökokouksen päätökset tai yhtiöjärjestyksen määräykset. Tyhjä rivi erottaa kappaleet.">
              <Textarea id="extra" name="extra" rows={5} maxLength={4000} defaultValue={s.extra} />
            </Field>
            {canWrite ? (
              <div className="grid gap-3 border-t border-line pt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="visible" defaultChecked={RENOVATION_GUIDE_TEMPLATE_APPROVED} className="mt-0.5 size-4" />
                  Näytä julkaistu ohje osakkaille (osakas kuittaa sen muutostyöilmoituksessa)
                </label>
                <div className="flex flex-wrap gap-3">
                  <Button name="intent" value="save" variant="secondary">
                    Tallenna tiedot
                  </Button>
                  <Button name="intent" value="publish">
                    Tallenna ja julkaise ohje
                  </Button>
                </div>
              </div>
            ) : null}
          </form>
        </Panel>

        <Panel>
          <SectionTitle>Tallennetut ohjeet</SectionTitle>
          {history.length === 0 ? (
            <p className="text-sm text-ink/65">Yhtiölle ei ole tallennettu muutostyöohjetta. Osakas voi silti tehdä ilmoituksen, mutta kuittaukseen ei liity ohjetta.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Ohje</Th>
                  <Th>Näkyvyys</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-sky">
                        {d.title}
                      </a>
                      <span className="block text-xs text-ink/55">
                        {formatDate(d.created_at)}
                        {current[0]?.id === d.id ? " · osakkaiden kuittaama versio" : ""}
                      </span>
                    </Td>
                    <Td>{d.visibility === "internal" ? "Vain henkilökunta" : "Osakkaat"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-4 text-sm text-ink/65">
            Oman ohjetiedoston voi myös ladata{" "}
            <Link href={`/taloyhtiot/${id}/dokumentit`} className="text-sky">
              dokumentteihin
            </Link>{" "}
            luokkaan Muutostyöohje.
          </p>
        </Panel>
      </div>
    </>
  );
}
