import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatBytes, VISIBILITY_LABEL } from "@/lib/documents/labels";
import { isoDateHelsinki } from "@/lib/format";
import {
  EMERGENCY_INSTRUCTIONS,
  PLAN_SECTIONS,
  RISK_LEVEL_LABEL,
  RISK_LEVELS,
  SHELTER_LABEL,
  SHELTER_OPTIONS,
  type PlanSectionKey,
  type RescuePlanContent,
} from "@/lib/rescue-plans/content";
import { hazardsForForm } from "@/lib/rescue-plans/form";
import { nextReviewDate } from "@/lib/rescue-plans/prefill";
import { currentAndDraft, listAttachmentCandidates, listPlans, PLAN_VISIBILITIES } from "@/lib/rescue-plans/queries";
import { saveRescuePlanDraft } from "../actions";

export const metadata = { title: "Pelastussuunnitelman luonnos" };

const NOTICE: Record<string, string> = {
  tallennettu: "Luonnos tallennettu.",
  esikatselu: "Luonnos tallennettu. Avaa esikatselu alta.",
  rekisteri: "Perustiedot ja yhteystiedot päivitettiin rekisteristä. Muut kentät säilyivät.",
};

function Section({ id, lead, children }: { id: PlanSectionKey; lead?: ReactNode; children: ReactNode }) {
  const index = PLAN_SECTIONS.findIndex((s) => s.key === id);
  return (
    <Panel aria-labelledby={`osio-${id}`}>
      <h2 id={`osio-${id}`} className="text-lg">
        <span className="mr-2 text-sky">{index + 1}</span>
        {PLAN_SECTIONS[index].title}
      </h2>
      {lead ? <p className="mt-1 text-sm text-ink/60">{lead}</p> : null}
      <div className="mt-4 grid gap-4">{children}</div>
    </Panel>
  );
}

type TextKey = { [K in keyof RescuePlanContent]: RescuePlanContent[K] extends string ? K : never }[keyof RescuePlanContent];

export default async function RescuePlanDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const company = await loadCompany(ctx, id);
  if (!ctx.can("owner", "manager", "assistant")) notFound();
  const [plans, candidates] = await ctx.run((tx) => Promise.all([listPlans(tx, id), listAttachmentCandidates(tx, id)]));
  const { draft } = currentAndDraft(plans);
  if (!draft) redirect(`/taloyhtiot/${id}/pelastussuunnitelma`);

  const c = draft.content;
  const today = isoDateHelsinki();
  const preparedOn = draft.prepared_on ?? today;
  const nextReview = draft.next_review_on ?? nextReviewDate(preparedOn);
  const hazards = hazardsForForm(c);
  const customRows = 2;
  const buildingRows = [...c.buildings, { label: "", type: "", completedYear: "", floors: "", material: "", heating: "", ventilation: "" }];

  const text = (key: TextKey, label: string, opts: { hint?: string; area?: boolean; wide?: boolean; placeholder?: string } = {}) => (
    <div className={opts.wide || opts.area ? "sm:col-span-2" : undefined}>
      <Field label={label} htmlFor={`f_${key}`} hint={opts.hint}>
        {opts.area ? (
          <Textarea id={`f_${key}`} name={key} defaultValue={c[key]} placeholder={opts.placeholder} rows={3} />
        ) : (
          <Input id={`f_${key}`} name={key} defaultValue={c[key]} placeholder={opts.placeholder} />
        )}
      </Field>
    </div>
  );

  return (
    <>
      <CompanyHeader company={company} active="pelastussuunnitelma" sub={`Versio ${draft.version} (luonnos)`} title={`Pelastussuunnitelma, versio ${draft.version}`} />
      <FormError message={sp.virhe} />
      {sp.tila && NOTICE[sp.tila] ? (
        <div className="mb-4">
          <Notice tone="ok" title={NOTICE[sp.tila]}>
            {sp.tila === "esikatselu" ? (
              <a href={`/taloyhtiot/${id}/pelastussuunnitelma/${draft.id}/esikatselu`} target="_blank" rel="noopener" className="font-semibold text-sky">
                Avaa esikatselu (PDF)
              </a>
            ) : null}
          </Notice>
        </div>
      ) : null}

      <form action={saveRescuePlanDraft} className="grid gap-6">
        <input type="hidden" name="company_id" value={id} />
        <input type="hidden" name="plan_id" value={draft.id} />
        <input type="hidden" name="building_count" value={buildingRows.length} />
        <input type="hidden" name="hazard_count" value={hazards.length + customRows} />

        <Section id="plan" lead="Suunnitelmasta vastaa taloyhtiön hallitus. Isännöitsijä laatii sen yleensä yhdessä hallituksen kanssa.">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("preparedBy", "Laatija")}
            <Field label="Hallitus hyväksynyt" htmlFor="f_boardApprovedOn" hint="Jätä tyhjäksi, jos ei vielä käsitelty.">
              <Input id="f_boardApprovedOn" name="boardApprovedOn" type="date" defaultValue={c.boardApprovedOn} />
            </Field>
            {text("preparationNote", "Miten suunnitelma on laadittu", { area: true })}
          </div>
        </Section>

        <Section id="property" lead="Esitäytetty rekisteristä. Muutokset rekisteriin tehdään Kiinteistö- ja Huoneistot-sivuilla; tässä voit tarkentaa suunnitelman tekstiä.">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("companyName", "Taloyhtiö")}
            {text("address", "Osoite")}
            {text("propertyCodes", "Kiinteistötunnus")}
            {text("apartments", "Asuinhuoneistot")}
            {text("residentsEstimate", "Asukkaita", { hint: "Arvio riittää, esim. noin 20." })}
            {text("commercialUnits", "Liike- ja toimitilat")}
            {text("heating", "Lämmitys")}
            {text("fireplaces", "Tulisijat", { placeholder: "esim. varaavat takat osassa asuntoja" })}
            {text("commonSpaces", "Yhteiset tilat")}
            {text("storages", "Varastot", { placeholder: "esim. asuntokohtaiset kylmät varastot, yhteinen pihavarasto" })}
            {text("parking", "Autopaikat ja lataus")}
            {text("keySystem", "Avainjärjestelmä ja yleisavain", { placeholder: "esim. yleisavain isännöitsijällä ja huoltoyhtiöllä" })}
            {text("hazardousMaterials", "Vaaralliset aineet", { area: true })}
            {text("unusualUse", "Tavanomaisesta poikkeava tai tilapäinen käyttö", { area: true, hint: "Esim. kerhohuoneen vuokraus tai remontin aikaiset järjestelyt (VNa 407/2011 2 §). Tyhjänä ei tulostu." })}
          </div>
          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold">Rakennukset</legend>
            {buildingRows.map((b, i) => (
              <div key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-4">
                {(
                  [
                    ["label", "Tunnus"], ["type", "Tyyppi"], ["completedYear", "Valmistunut"], ["floors", "Kerroksia"],
                    ["material", "Rakenteet"], ["heating", "Lämmitys"], ["ventilation", "Ilmanvaihto"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={`b${i}_${key}`}>
                    <Input id={`b${i}_${key}`} name={`b${i}_${key}`} defaultValue={b[key]} />
                  </Field>
                ))}
                {i < c.buildings.length ? (
                  <label className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm">
                    <input type="checkbox" name={`b${i}_remove`} className="size-5" /> Poista suunnitelmasta
                  </label>
                ) : (
                  <p className="self-end text-xs text-ink/55">Uusi rivi: täytä lisätäksesi rakennuksen.</p>
                )}
              </div>
            ))}
          </fieldset>
        </Section>

        <Section id="contacts" lead="Nimet ja numerot tulostuvat asukkaille jaettavaan suunnitelmaan. Kirjaa vain tehtävän hoitamiseen tarvittavat yhteystiedot.">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("managerName", "Isännöitsijä")}
            {text("managerPhone", "Isännöitsijän puhelin")}
            {text("managerEmail", "Isännöitsijän sähköposti")}
            {text("chairName", "Hallituksen puheenjohtaja")}
            {text("chairPhone", "Puheenjohtajan puhelin")}
            {text("maintenanceName", "Kiinteistöhuolto")}
            {text("maintenancePhone", "Huollon puhelin")}
            {text("maintenanceEmergencyPhone", "Huollon päivystys")}
            {text("safetyPersons", "Turvallisuushenkilöt", { area: true, hint: "Esim. turvallisuusvastaava ja varahenkilö tai väestönsuojan vastuuhenkilö. Yksi henkilö riville." })}
            {text("otherContacts", "Muut numerot", { area: true, placeholder: "Sähköyhtiön vikailmoitus, vesilaitos, vakuutusyhtiö" })}
          </div>
        </Section>

        <Section id="hazards" lead="Valitse yhtiötä koskevat vaaratilanteet. Vakiotekstejä voi muokata, ja omia lisätään alimmille riveille.">
          {text("riskConclusions", "Johtopäätökset", { area: true, hint: "Tyhjänä PDF kokoaa johtopäätöksen suurimmista riskitasoista." })}
          <div className="grid gap-3">
            {[...hazards, ...Array.from({ length: customRows }, () => null)].map((h, i) => (
              <fieldset key={h?.key ?? `uusi-${i}`} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_12rem]">
                <legend className="sr-only">{h?.title || "Oma vaaratilanne"}</legend>
                <input type="hidden" name={`h${i}_key`} value={h?.key ?? ""} />
                <input type="hidden" name={`h${i}_custom`} value={h?.custom || !h ? "1" : "0"} />
                <div className="flex items-start gap-3">
                  <input type="checkbox" id={`h${i}_selected`} name={`h${i}_selected`} defaultChecked={h ? h.selected : true} className="mt-3 size-5 shrink-0" aria-label="Mukana suunnitelmassa" />
                  <div className="min-w-0 flex-1">
                    <Field label={h ? "Vaaratilanne" : "Oma vaaratilanne"} htmlFor={`h${i}_title`}>
                      <Input id={`h${i}_title`} name={`h${i}_title`} defaultValue={h?.title ?? ""} />
                    </Field>
                  </div>
                </div>
                <Field label="Riskitaso" htmlFor={`h${i}_level`}>
                  <Select id={`h${i}_level`} name={`h${i}_level`} defaultValue={String(h?.level ?? 2)}>
                    {RISK_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l} {RISK_LEVEL_LABEL[l]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Seuraus" htmlFor={`h${i}_consequence`}>
                    <Textarea id={`h${i}_consequence`} name={`h${i}_consequence`} defaultValue={h?.consequence ?? ""} rows={2} className="min-h-16" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Ehkäisy ja turvallisuusjärjestelyt" htmlFor={`h${i}_prevention`}>
                    <Textarea id={`h${i}_prevention`} name={`h${i}_prevention`} defaultValue={h?.prevention ?? ""} rows={3} />
                  </Field>
                </div>
              </fieldset>
            ))}
          </div>
        </Section>

        <Section id="safety">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("smokeAlarms", "Palovaroittimet", { area: true })}
            {text("extinguishers", "Alkusammutusvälineet ja sijainnit", { area: true, placeholder: "esim. sammutuspeite jokaisessa asunnossa, käsisammutin kerhohuoneessa" })}
            {text("escapeRoutes", "Poistumistiet", { area: true })}
            {text("rescueRoad", "Pelastustie", { area: true })}
            {text("assemblyPoint", "Kokoontumispaikka", { placeholder: "esim. jätekatoksen edessä pihalla" })}
            {text("assemblyPointAlt", "Varakokoontumispaikka")}
            {text("shutoffWater", "Veden pääsulku", { placeholder: "sijainti ja käyttö" })}
            {text("shutoffElectricity", "Sähkön pääkytkin")}
            {text("shutoffVentilation", "Ilmanvaihdon pysäytys", { placeholder: "esim. huoneistokohtainen kytkin keittiössä" })}
            {text("shutoffHeating", "Lämmityksen sulku")}
            {text("storageRules", "Tilojen järjestys ja varastointi", { area: true })}
            {text("hotWork", "Tulityöt", { area: true })}
            {text("inspections", "Huollot ja tarkastukset", { area: true })}
          </div>
        </Section>

        <Section id="instructions" lead="Vakio-ohjeet tulostuvat suunnitelmaan sellaisinaan. Kokoontumispaikka lisätään poistumisohjeeseen.">
          <ul className="grid gap-1 text-sm text-ink/75 sm:grid-cols-2">
            {EMERGENCY_INSTRUCTIONS.map((i) => (
              <li key={i.key}>· {i.title}</li>
            ))}
          </ul>
          {text("extraInstructions", "Yhtiön omat lisäohjeet", { area: true, placeholder: "esim. hissin tarkistus sähkökatkon jälkeen, saunan käyttövuorot" })}
        </Section>

        <Section id="civil_defence">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Väestönsuoja" htmlFor="f_shelter">
              <Select id="f_shelter" name="shelter" defaultValue={c.shelter}>
                {SHELTER_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {SHELTER_LABEL[o]}
                  </option>
                ))}
              </Select>
            </Field>
            {text("shelterLocation", "Suojan sijainti")}
            {text("shelterCapacity", "Suojapaikkoja")}
            {text("shelterResponsible", "Vastuuhenkilö")}
            {text("shelterNotes", "Lisätiedot", { area: true, hint: "Esim. arkikäyttö (varasto) ja tyhjennyksen järjestelyt, lähin yleinen suoja." })}
          </div>
        </Section>

        <Section id="communication">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("communication", "Tiedottaminen asukkaille", { area: true })}
            {text("training", "Koulutus ja harjoittelu", { area: true })}
          </div>
        </Section>

        <Section id="maintenance">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Laadittu / päivitetty" htmlFor="prepared_on">
              <Input id="prepared_on" name="prepared_on" type="date" defaultValue={preparedOn} required />
            </Field>
            <Field label="Seuraava tarkistus" htmlFor="next_review_on" hint="Tulee vuosikelloon tehtäväksi, kun suunnitelma merkitään valmiiksi.">
              <Input id="next_review_on" name="next_review_on" type="date" defaultValue={nextReview} required />
            </Field>
            {text("updateProcedure", "Päivitysmenettely", { area: true })}
          </div>
        </Section>

        <Section id="attachments" lead="Yhtiön pohjapiirustukset ja asemapiirrokset (dokumentit, luokka Pohjapiirustus, ei huoneistoon liitetyt). PDF, PNG ja JPEG liitetään suunnitelman perään.">
          {candidates.length === 0 ? (
            <p className="text-sm text-ink/60">Yhtiön tason pohjapiirustuksia ei ole. Lisää asemapiirros Dokumentit-sivulla, jos haluat sen liitteeksi.</p>
          ) : (
            <ul className="grid gap-2">
              {candidates.map((d) => (
                <li key={d.id}>
                  <label className="flex min-h-[var(--size-touch)] items-center gap-3 text-sm">
                    <input type="checkbox" name={`att_${d.id}`} defaultChecked={c.attachmentDocumentIds.includes(d.id)} className="size-5" />
                    <span className="min-w-0">
                      <span className="font-semibold">{d.title}</span>
                      <span className="block text-xs text-ink/55">{formatBytes(d.size_bytes)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {text("attachmentNotes", "Muut liitteet ja huomiot", { area: true, placeholder: "esim. poistumisreittikaavio ilmoitustaululla" })}
        </Section>

        <Panel className="grid gap-4">
          <h2 className="text-lg">Tallennus</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Näkyvyys valmiina" htmlFor="visibility" hint="Suunnitelma on saatettava asukkaiden tietoon, joten oletus on kaikki asukkaat.">
              <Select id="visibility" name="visibility" defaultValue={draft.visibility}>
                {PLAN_VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABEL[v]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" name="intent" value="save">
              Tallenna luonnos
            </Button>
            <Button variant="secondary" name="intent" value="preview">
              Tallenna ja esikatsele
            </Button>
            <Button variant="ghost" name="intent" value="registry">
              Päivitä rekisteristä
            </Button>
          </div>
          <div className="border-t border-line pt-4">
            <Button name="intent" value="finalize">
              Tallenna valmiina
            </Button>
            <p className="mt-2 text-xs text-ink/60">
              Valmis versio tallentuu PDF:nä yhtiön dokumentteihin valitulla näkyvyydellä, korvaa edellisen version ja lisää tarkistuksen vuosikelloon. Valmista versiota ei voi
              enää muokata; muutokset tehdään uutena versiona.
            </p>
          </div>
        </Panel>
      </form>
    </>
  );
}
