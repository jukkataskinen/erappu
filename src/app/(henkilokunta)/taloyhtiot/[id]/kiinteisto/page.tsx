import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Button, DefinitionList, EmptyState, Field, Input, Panel, SectionTitle, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, formatNumber } from "@/lib/format";
import { listBuildings, listProperties, type BuildingRow, type PropertyRow } from "@/lib/registry/queries";
import { addBuilding, saveProperty, updateBuilding, updateBuildingHeating } from "../../actions";
import { HEATING_TYPE_LABEL, HEATING_TYPES, type HeatingType } from "@/lib/consumption/heating";

export const metadata = { title: "Kiinteistö ja rakennukset" };

const TENURE: Record<string, string> = { own: "Oma tontti", lease: "Vuokratontti" };

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

function PropertyForm({ companyId, p }: { companyId: string; p?: PropertyRow }) {
  return (
    <form action={saveProperty} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="id" value={p?.id ?? ""} />
      <Field label="Kiinteistötunnus" htmlFor={`property_code_${p?.id ?? "uusi"}`}>
        <Input id={`property_code_${p?.id ?? "uusi"}`} name="property_code" required defaultValue={p?.property_code ?? ""} placeholder="850-405-5-900" />
      </Field>
      <Field label="Hallinta" htmlFor={`tenure_${p?.id ?? "uusi"}`}>
        <Select id={`tenure_${p?.id ?? "uusi"}`} name="tenure" defaultValue={p?.tenure ?? ""}>
          <option value="">Ei tiedossa</option>
          <option value="own">Oma tontti</option>
          <option value="lease">Vuokratontti</option>
        </Select>
      </Field>
      <Field label="Pinta-ala (m²)" htmlFor={`area_${p?.id ?? "uusi"}`}>
        <Input id={`area_${p?.id ?? "uusi"}`} name="area_m2" inputMode="decimal" defaultValue={num(p?.area_m2)} />
      </Field>
      <Field label="Vuokranantaja" htmlFor={`lessor_${p?.id ?? "uusi"}`}>
        <Input id={`lessor_${p?.id ?? "uusi"}`} name="lessor" defaultValue={p?.lessor ?? ""} />
      </Field>
      <Field label="Vuokra päättyy" htmlFor={`lease_${p?.id ?? "uusi"}`}>
        <Input id={`lease_${p?.id ?? "uusi"}`} name="lease_ends_on" type="date" defaultValue={p?.lease_ends_on ?? ""} />
      </Field>
      <Field label="Vuosivuokra (€)" htmlFor={`rent_${p?.id ?? "uusi"}`}>
        <Input id={`rent_${p?.id ?? "uusi"}`} name="annual_rent_eur" inputMode="decimal" defaultValue={num(p?.annual_rent_eur)} />
      </Field>
      <Field label="Vuokran tarkistusperuste" htmlFor={`review_${p?.id ?? "uusi"}`}>
        <Input id={`review_${p?.id ?? "uusi"}`} name="rent_review_basis" defaultValue={p?.rent_review_basis ?? ""} />
      </Field>
      <Field label="Rakennusoikeus (k-m²)" htmlFor={`rights_${p?.id ?? "uusi"}`}>
        <Input id={`rights_${p?.id ?? "uusi"}`} name="building_rights_m2" inputMode="decimal" defaultValue={num(p?.building_rights_m2)} />
      </Field>
      <Field label="Käyttämätön (k-m²)" htmlFor={`unused_${p?.id ?? "uusi"}`}>
        <Input id={`unused_${p?.id ?? "uusi"}`} name="unused_building_rights_m2" inputMode="decimal" defaultValue={num(p?.unused_building_rights_m2)} />
      </Field>
      <Field label="Autopaikat kaavassa" htmlFor={`planned_${p?.id ?? "uusi"}`}>
        <Input id={`planned_${p?.id ?? "uusi"}`} name="parking_spaces_planned" inputMode="numeric" defaultValue={p?.parking_spaces_planned ?? ""} />
      </Field>
      <Field label="Autopaikat toteutuneet" htmlFor={`built_${p?.id ?? "uusi"}`}>
        <Input id={`built_${p?.id ?? "uusi"}`} name="parking_spaces_built" inputMode="numeric" defaultValue={p?.parking_spaces_built ?? ""} />
      </Field>
      <div className="flex items-end">
        <Button variant="secondary">{p ? "Tallenna kiinteistö" : "Lisää kiinteistö"}</Button>
      </div>
    </form>
  );
}

function BuildingEditForm({ companyId, b }: { companyId: string; b: BuildingRow }) {
  const text = (name: keyof BuildingRow, label: string, hint?: string) => (
    <Field label={label} htmlFor={`b_${name}`} hint={hint}>
      <Input id={`b_${name}`} name={name} defaultValue={b[name] === null || b[name] === undefined ? "" : num(b[name] as string | number)} />
    </Field>
  );
  return (
    <form action={updateBuilding} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="building_id" value={b.id} />
      {text("label", "Tunnus")}
      {text("building_type", "Talotyyppi")}
      {text("completed_year", "Valmistumisvuosi")}
      {text("floors", "Kerroksia")}
      {text("staircases", "Porrashuoneita")}
      {text("elevators", "Hissejä")}
      {text("apartment_area_m2", "Huoneistoala m²")}
      {text("floor_area_m2", "Kerrosala m²")}
      {text("volume_m3", "Tilavuus m³")}
      {text("construction_material", "Rakennusaine")}
      {text("roof_type", "Kattotyyppi")}
      {text("roof_material", "Katemateriaali")}
      {text("heating", "Lämmitysenergia", "esim. kaukolämpö")}
      <Field label="Lämmitysmuoto (luokka)" htmlFor="b_heating_type">
        <Select id="b_heating_type" name="heating_type" defaultValue={b.heating_type ?? ""}>
          <option value="">Ei tiedossa</option>
          {HEATING_TYPES.map((t) => (
            <option key={t} value={t}>
              {HEATING_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      {text("heat_distribution", "Lämmönjako", "esim. vesikiertoiset patterit")}
      {text("cooling", "Jäähdytys")}
      {text("ventilation", "Ilmanvaihto")}
      {text("antenna", "Antennijärjestelmä")}
      {text("antenna_provider", "Antennin palveluntarjoaja")}
      {text("broadband", "Laajakaista")}
      {text("broadband_provider", "Laajakaistan palveluntarjoaja")}
      {text("energy_class", "Energialuokka")}
      {text("energy_certificate_year", "Energiatodistuksen vuosi")}
      <Field label="Yhteistilat" htmlFor="b_common_spaces" hint="Pilkulla erotettuna">
        <Input id="b_common_spaces" name="common_spaces" defaultValue={b.common_spaces.join(", ")} />
      </Field>
      <div className="flex items-end gap-3 sm:col-span-3">
        <Button variant="secondary">Tallenna rakennus</Button>
        <Link href={`/taloyhtiot/${companyId}/kiinteisto`} className="text-sm text-ink/60">
          Peru
        </Link>
      </div>
    </form>
  );
}

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; muokkaa?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe, muokkaa } = await searchParams;
  const [buildings, properties] = await ctx.run((tx) => Promise.all([listBuildings(tx, id), listProperties(tx, id)]));
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <CompanyHeader company={company} active="kiinteisto" />
      <FormError message={virhe} />
      <div className="grid gap-6">
        <Panel>
          <SectionTitle>Kiinteistöt</SectionTitle>
          {properties.length === 0 ? (
            <p className="text-sm text-ink/65">Kiinteistötunnusta ei ole kirjattu.</p>
          ) : (
            <div className="grid gap-5">
              {properties.map((p) => (
                <div key={p.id} className="grid gap-3">
                  <DefinitionList
                    items={[
                      { label: "Kiinteistötunnus", value: p.property_code },
                      { label: "Hallinta", value: p.tenure ? TENURE[p.tenure] : "–" },
                      { label: "Pinta-ala", value: formatNumber(p.area_m2, "m²") },
                      ...(p.tenure === "lease"
                        ? [
                            { label: "Vuokranantaja", value: p.lessor },
                            { label: "Vuokra päättyy", value: formatDate(p.lease_ends_on) },
                            { label: "Vuosivuokra", value: p.annual_rent_eur ? formatEur(p.annual_rent_eur) : "–" },
                          ]
                        : []),
                      { label: "Rakennusoikeus / käyttämätön", value: `${formatNumber(p.building_rights_m2, "k-m²")} / ${formatNumber(p.unused_building_rights_m2, "k-m²")}` },
                      { label: "Autopaikat kaavassa / toteutuneet", value: `${p.parking_spaces_planned ?? "–"} / ${p.parking_spaces_built ?? "–"}` },
                    ]}
                  />
                  {canWrite ? (
                    <details className="rounded-xl border border-line p-3">
                      <summary className="cursor-pointer text-sm font-semibold">Muokkaa kiinteistöä</summary>
                      <div className="mt-3">
                        <PropertyForm companyId={id} p={p} />
                      </div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {canWrite ? (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold">Lisää kiinteistö</summary>
              <div className="mt-3">
                <PropertyForm companyId={id} />
              </div>
            </details>
          ) : null}
        </Panel>

        {buildings.length === 0 ? (
          <EmptyState title="Rakennuksia ei ole kirjattu" />
        ) : (
          buildings.map((b) => (
            <Panel key={b.id}>
              <SectionTitle
                actions={
                  canWrite && muokkaa !== b.id ? (
                    <Link href={`/taloyhtiot/${id}/kiinteisto?muokkaa=${b.id}`} className="text-sm text-sky">
                      Muokkaa
                    </Link>
                  ) : null
                }
              >
                {b.label ? `Rakennus ${b.label}` : "Rakennus"}
              </SectionTitle>
              {canWrite && muokkaa === b.id ? (
                <BuildingEditForm companyId={id} b={b} />
              ) : (
                <DefinitionList
                  items={[
                    { label: "Talotyyppi", value: b.building_type },
                    { label: "Valmistumisvuosi", value: b.completed_year },
                    { label: "Kerroksia / porrashuoneita", value: `${b.floors ?? "–"} / ${b.staircases ?? "–"}` },
                    { label: "Hissejä", value: b.elevators },
                    { label: "Huoneistoala", value: formatNumber(b.apartment_area_m2, "m²") },
                    { label: "Kerrosala", value: formatNumber(b.floor_area_m2, "m²") },
                    { label: "Tilavuus", value: formatNumber(b.volume_m3, "m³") },
                    { label: "Rakennusaine", value: b.construction_material },
                    { label: "Katto", value: [b.roof_type, b.roof_material].filter(Boolean).join(", ") || "–" },
                    {
                      label: "Lämmitysmuoto",
                      value: canWrite ? (
                        <form action={updateBuildingHeating} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="company_id" value={id} />
                          <input type="hidden" name="building_id" value={b.id} />
                          <select
                            name="heating_type"
                            defaultValue={b.heating_type ?? ""}
                            aria-label="Lämmitysmuoto"
                            className="min-h-9 rounded-lg border border-line bg-paper px-2 text-sm"
                          >
                            <option value="">Ei tiedossa</option>
                            {HEATING_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {HEATING_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                          <button className="text-sm text-sky">Tallenna</button>
                          {b.heating ? <span className="text-xs text-ink/50">Accessissa: {b.heating}</span> : null}
                        </form>
                      ) : (
                        (b.heating_type ? HEATING_TYPE_LABEL[b.heating_type as HeatingType] : b.heating) ?? "–"
                      ),
                    },
                    { label: "Lämmönjako", value: b.heat_distribution },
                    { label: "Jäähdytys", value: b.cooling },
                    { label: "Ilmanvaihto", value: b.ventilation },
                    { label: "Antenni", value: [b.antenna, b.antenna_provider].filter(Boolean).join(", ") || "–" },
                    { label: "Laajakaista", value: [b.broadband, b.broadband_provider].filter(Boolean).join(", ") || "–" },
                    { label: "Energiatodistus", value: [b.energy_class, b.energy_certificate_year].filter(Boolean).join(", ") || "–" },
                    { label: "Yhteistilat", value: b.common_spaces.length ? b.common_spaces.join(", ") : "–" },
                  ]}
                />
              )}
            </Panel>
          ))
        )}

        {canWrite ? (
          <Panel>
            <SectionTitle>Lisää rakennus</SectionTitle>
            <form action={addBuilding} className="grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="company_id" value={id} />
              <Field label="Tunnus" htmlFor="label">
                <Input id="label" name="label" placeholder="A" />
              </Field>
              <Field label="Talotyyppi" htmlFor="building_type">
                <Input id="building_type" name="building_type" placeholder="Rivitalo" />
              </Field>
              <Field label="Valmistumisvuosi" htmlFor="completed_year">
                <Input id="completed_year" name="completed_year" inputMode="numeric" />
              </Field>
              <Field label="Huoneistoala m²" htmlFor="apartment_area_m2">
                <Input id="apartment_area_m2" name="apartment_area_m2" inputMode="decimal" />
              </Field>
              <Field label="Lämmitysmuoto" htmlFor="heating_type">
                <select id="heating_type" name="heating_type" defaultValue="" className="min-h-[var(--size-touch)] w-full rounded-xl border border-line bg-paper px-3.5 text-base">
                  <option value="">Ei tiedossa</option>
                  {HEATING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {HEATING_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ilmanvaihto" htmlFor="ventilation">
                <Input id="ventilation" name="ventilation" />
              </Field>
              <Field label="Rakennusaine" htmlFor="construction_material">
                <Input id="construction_material" name="construction_material" />
              </Field>
              <Field label="Kattotyyppi" htmlFor="roof_type">
                <Input id="roof_type" name="roof_type" />
              </Field>
              <Field label="Yhteistilat" htmlFor="common_spaces" hint="Pilkulla erotettuna">
                <Input id="common_spaces" name="common_spaces" placeholder="sauna, kerhohuone" />
              </Field>
              <div className="sm:col-span-3">
                <Button variant="secondary">Lisää rakennus</Button>
              </div>
            </form>
            <p className="mt-3 text-xs text-ink/55">Muut tiedot (porrashuoneet, hissit, lämmönjako, tietoliikenne) lisätään rakennuksen Muokkaa-kohdasta.</p>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
