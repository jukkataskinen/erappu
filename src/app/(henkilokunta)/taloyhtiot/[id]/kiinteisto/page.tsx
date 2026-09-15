import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Button, DefinitionList, EmptyState, Field, Input, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatNumber } from "@/lib/format";
import { listBuildings, listProperties } from "@/lib/registry/queries";
import { addBuilding, updateBuildingHeating } from "../../actions";
import { HEATING_TYPE_LABEL, HEATING_TYPES, type HeatingType } from "@/lib/consumption/heating";

export const metadata = { title: "Kiinteistö ja rakennukset" };

const TENURE: Record<string, string> = { own: "Oma tontti", lease: "Vuokratontti" };

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
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
                <DefinitionList
                  key={p.id}
                  items={[
                    { label: "Kiinteistötunnus", value: p.property_code },
                    { label: "Hallinta", value: p.tenure ? TENURE[p.tenure] : "–" },
                    { label: "Pinta-ala", value: formatNumber(p.area_m2, "m²") },
                    { label: "Autopaikat kaavassa / toteutuneet", value: `${p.parking_spaces_planned ?? "–"} / ${p.parking_spaces_built ?? "–"}` },
                    { label: "Käyttämätön rakennusoikeus", value: formatNumber(p.unused_building_rights_m2, "k-m²") },
                  ]}
                />
              ))}
            </div>
          )}
        </Panel>

        {buildings.length === 0 ? (
          <EmptyState title="Rakennuksia ei ole kirjattu" />
        ) : (
          buildings.map((b) => (
            <Panel key={b.id}>
              <SectionTitle>{b.label ? `Rakennus ${b.label}` : "Rakennus"}</SectionTitle>
              <DefinitionList
                items={[
                  { label: "Talotyyppi", value: b.building_type },
                  { label: "Valmistumisvuosi", value: b.completed_year },
                  { label: "Kerroksia", value: b.floors },
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
                  { label: "Ilmanvaihto", value: b.ventilation },
                  { label: "Energiatodistus", value: [b.energy_class, b.energy_certificate_year].filter(Boolean).join(", ") || "–" },
                  { label: "Yhteistilat", value: b.common_spaces.length ? b.common_spaces.join(", ") : "–" },
                ]}
              />
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
          </Panel>
        ) : null}
      </div>
    </>
  );
}
