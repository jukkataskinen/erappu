import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, Field, Input, LinkButton, Panel, SectionTitle, Select, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { isEffectiveOn } from "@/lib/finance/charges";
import { loadChargeBases } from "@/lib/finance/billing";
import { formatPrice, RUN_STATUS, trimDecimal } from "@/lib/finance/labels";
import { listAdvances, listMeters, listRounds } from "@/lib/water/queries";
import { METER_KIND } from "@/lib/water/settlement";
import { addMeterAction, createRoundAction, deleteAdvanceAction, deleteMeterAction, replaceMeterAction, setAdvanceAction } from "./actions";

export const metadata = { title: "Vesilaskutus" };

/**
 * Vesimittarit, vesiennakot ja lukukierrokset. Tasauslasku tehdään
 * lukukierroksen sivulta, ja se on tavallinen laskutusajo (hyväksyntä,
 * vienti kirjanpitoon).
 */
export default async function WaterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const today = isoDateHelsinki();

  const { meters, advances, rounds, bases, groups } = await ctx.run(async (tx) => ({
    meters: await listMeters(tx, id),
    advances: await listAdvances(tx, id),
    rounds: await listRounds(tx, id),
    bases: await loadChargeBases(tx, id),
    groups: await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1 and removed_on is null", [id]),
  }));
  groups.sort((a, b) => a.unit_label.localeCompare(b.unit_label, "fi", { numeric: true }));
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");

  const activeMeters = meters.filter((m) => !m.removed_on);
  const removedMeters = meters.filter((m) => m.removed_on);
  const currentAdvances = advances.filter((a) => a.starts_on <= today && (a.ends_on === null || a.ends_on >= today));
  const upcomingAdvances = advances.filter((a) => a.starts_on > today);
  const pastAdvances = advances.filter((a) => a.ends_on !== null && a.ends_on < today);
  const advanceTotal = currentAdvances.reduce((s, a) => s + Number(a.monthly_eur), 0);
  const prices = bases.filter((b) => b.basis === "meter" && (b.charge_type === "water" || b.charge_type === "hot_water"));
  const coldPrice = prices.find((b) => b.charge_type === "water" && isEffectiveOn(b, today));
  const hotPrice = prices.find((b) => b.charge_type === "hot_water" && isEffectiveOn(b, today));
  const hasHot = activeMeters.some((m) => m.kind === "hot");
  const hidden = <input type="hidden" name="company_id" value={id} />;

  return (
    <>
      <CompanyHeader company={company} active="talous" sub="Vesilaskutus" />
      <FormError message={virhe} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Mittareita" value={`${activeMeters.length}${hasHot ? ` (${activeMeters.filter((m) => m.kind === "hot").length} lämmin)` : ""}`} />
        <Stat label="Vesi €/m³" value={coldPrice ? `${formatPrice(coldPrice.unit_price)} €` : "Ei hintaa"} tone={coldPrice ? undefined : "warn"} />
        <Stat label="Lämmin vesi €/m³" value={hotPrice ? `${formatPrice(hotPrice.unit_price)} €` : hasHot ? "Veden hinta" : "–"} />
        <Stat label="Vesiennakot / kk" value={formatEur(advanceTotal.toFixed(2))} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel id="kierrokset">
            <SectionTitle>Lukukierrokset ja tasauslaskut</SectionTitle>
            {canWrite ? (
              <form action={createRoundAction} className="mb-4 flex flex-wrap items-end gap-3">
                {hidden}
                <Field label="Lukemapäivä" htmlFor="read_on">
                  <Input id="read_on" name="read_on" type="date" defaultValue={`${today.slice(0, 4)}-12-31`} required className="w-44" />
                </Field>
                <label className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm">
                  <input type="checkbox" name="portal_open" defaultChecked /> Osakkaat voivat ilmoittaa lukeman portaalissa
                </label>
                <Button variant="secondary">Aloita lukukierros</Button>
              </form>
            ) : null}
            {rounds.length === 0 ? (
              <p className="text-sm text-ink/65">Lukukierroksia ei ole. Aloita kierros, kirjaa tai kerää lukemat ja tee tasauslasku kierroksen sivulta.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Lukemapäivä</Th>
                    <Th>Tila</Th>
                    <Th numeric>Lukemia</Th>
                    <Th>Tasauslasku</Th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => (
                    <tr key={r.id} className="hover:bg-cloud/50">
                      <Td>
                        <Link href={`/taloyhtiot/${id}/talous/vesi/lukemat/${r.id}`} className="font-semibold hover:text-sky">
                          {formatDate(r.read_on)}
                        </Link>
                      </Td>
                      <Td>
                        {r.status === "open" ? <Badge tone="info">{r.portal_open ? "Auki, portaali" : "Auki"}</Badge> : <Badge tone="neutral">Suljettu</Badge>}
                      </Td>
                      <Td numeric>
                        {r.reading_count}/{activeMeters.length}
                      </Td>
                      <Td>
                        {r.settlement_run_id ? (
                          <Link href={`/taloyhtiot/${id}/talous/ajot/${r.settlement_run_id}`} className="hover:text-sky">
                            <Badge tone={RUN_STATUS[r.settlement_status ?? "draft"]?.tone ?? "neutral"}>
                              {RUN_STATUS[r.settlement_status ?? "draft"]?.label}
                            </Badge>
                          </Link>
                        ) : (
                          <span className="text-sm text-ink/55">Ei tehty</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel id="mittarit">
            <SectionTitle>Mittarit</SectionTitle>
            {activeMeters.length === 0 ? (
              <p className="text-sm text-ink/65">Mittareita ei ole kirjattu. Lisää huoneistojen mittarit viimeksi laskutetulla lukemalla.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Huoneisto</Th>
                    <Th>Mittari</Th>
                    <Th numeric>Aloituslukema</Th>
                    {canWrite ? <Th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {activeMeters.map((m) => (
                    <tr key={m.id} className="align-top">
                      <Td className="font-semibold">{m.unit_label}</Td>
                      <Td>
                        <p>{METER_KIND[m.kind]}</p>
                        <p className="text-xs text-ink/55">
                          {[m.meter_number ? `nro ${m.meter_number}` : null, m.location].filter(Boolean).join(" · ") || "–"}
                        </p>
                      </Td>
                      <Td numeric>
                        {trimDecimal(m.start_reading)}
                        <p className="text-xs text-ink/55">{formatDate(m.installed_on)}</p>
                      </Td>
                      {canWrite ? (
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-sm text-sky">Vaihda</summary>
                            <form action={replaceMeterAction} className="mt-2 grid w-64 gap-2">
                              {hidden}
                              <input type="hidden" name="meter_id" value={m.id} />
                              <Field label="Vaihtopäivä" htmlFor={`removed_on_${m.id}`}>
                                <Input id={`removed_on_${m.id}`} name="removed_on" type="date" defaultValue={today} required />
                              </Field>
                              <Field label="Vanhan loppulukema" htmlFor={`final_${m.id}`}>
                                <Input id={`final_${m.id}`} name="final_reading" inputMode="decimal" required />
                              </Field>
                              <Field label="Uuden numero" htmlFor={`new_no_${m.id}`}>
                                <Input id={`new_no_${m.id}`} name="new_meter_number" />
                              </Field>
                              <Field label="Uuden aloituslukema" htmlFor={`new_start_${m.id}`} hint="Tyhjä = mittari poistuu ilman uutta">
                                <Input id={`new_start_${m.id}`} name="new_start_reading" inputMode="decimal" defaultValue="0" />
                              </Field>
                              <Button variant="secondary">Tallenna vaihto</Button>
                            </form>
                            <form action={deleteMeterAction} className="mt-2">
                              {hidden}
                              <input type="hidden" name="meter_id" value={m.id} />
                              <button className="text-xs text-coral">Poista virheellinen kirjaus</button>
                            </form>
                          </details>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {removedMeters.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink/70">Vaihdetut mittarit ({removedMeters.length})</summary>
                <ul className="mt-2 grid gap-1 text-sm">
                  {removedMeters.map((m) => (
                    <li key={m.id}>
                      {m.unit_label}, {METER_KIND[m.kind].toLowerCase()}
                      {m.meter_number ? ` nro ${m.meter_number}` : ""}: loppulukema {trimDecimal(m.final_reading)} ({formatDate(m.removed_on)})
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {canWrite ? (
              <details className="mt-4 border-t border-line pt-4" open={activeMeters.length === 0}>
                <summary className="cursor-pointer text-sm font-semibold">Lisää mittari</summary>
                <form action={addMeterAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  {hidden}
                  <Field label="Huoneisto" htmlFor="share_group_id">
                    <Select id="share_group_id" name="share_group_id" required defaultValue="">
                      <option value="" disabled>
                        Valitse
                      </option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.unit_label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Vesi" htmlFor="kind">
                    <Select id="kind" name="kind" defaultValue="cold">
                      <option value="cold">Kylmä vesi</option>
                      <option value="hot">Lämmin vesi</option>
                    </Select>
                  </Field>
                  <Field label="Aloituslukema (m³)" htmlFor="start_reading" hint="Viimeksi laskutettu lukema tai asennuslukema">
                    <Input id="start_reading" name="start_reading" inputMode="decimal" required />
                  </Field>
                  <Field label="Lukeman päivä" htmlFor="installed_on">
                    <Input id="installed_on" name="installed_on" type="date" required />
                  </Field>
                  <Field label="Mittarin numero" htmlFor="meter_number">
                    <Input id="meter_number" name="meter_number" />
                  </Field>
                  <Field label="Sijainti" htmlFor="location" hint="Esim. kylpyhuone">
                    <Input id="location" name="location" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Button variant="secondary">Lisää mittari</Button>
                  </div>
                </form>
              </details>
            ) : null}
          </Panel>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Panel id="ennakot">
            <SectionTitle>Vesiennakot</SectionTitle>
            <p className="mb-3 text-sm text-ink/65">
              Huoneistokohtaisesti sovittu ennakko laskutetaan kuukausittain vastikelaskulla ja hyvitetään tasauslaskulla miinusrivinä.
            </p>
            {currentAdvances.length + upcomingAdvances.length === 0 ? (
              <p className="text-sm text-ink/65">Ennakoita ei ole sovittu.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {[...currentAdvances, ...upcomingAdvances].map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p className="font-semibold">{a.unit_label}</p>
                      <p className="text-xs text-ink/55">
                        {a.starts_on > today ? "alkaen" : "voimassa"} {formatDate(a.starts_on)}
                        {a.ends_on ? `–${formatDate(a.ends_on)}` : ""}
                        {a.note ? ` · ${a.note}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular font-semibold">{formatEur(a.monthly_eur)}/kk</p>
                      {canWrite ? (
                        <form action={deleteAdvanceAction}>
                          {hidden}
                          <input type="hidden" name="advance_id" value={a.id} />
                          <button className="text-xs text-coral">Poista</button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pastAdvances.length > 0 ? (
              <p className="mt-2 text-xs text-ink/55">
                Päättyneitä ennakoita {pastAdvances.length}; ne hyvitetään tasauksessa kaudelta, jolla ne olivat voimassa.
              </p>
            ) : null}
            {canWrite ? (
              <form action={setAdvanceAction} className="mt-4 grid gap-3 border-t border-line pt-4">
                {hidden}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Huoneisto" htmlFor="adv_group">
                    <Select id="adv_group" name="share_group_id" required defaultValue="">
                      <option value="" disabled>
                        Valitse
                      </option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.unit_label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="€/kk" htmlFor="monthly_eur" hint="0 = ennakko päättyy">
                    <Input id="monthly_eur" name="monthly_eur" inputMode="decimal" required />
                  </Field>
                </div>
                <Field label="Voimassa alkaen" htmlFor="adv_starts" hint="Edellinen ennakko päättyy edellisenä päivänä">
                  <Input id="adv_starts" name="starts_on" type="date" defaultValue={`${today.slice(0, 7)}-01`} required />
                </Field>
                <Field label="Lisätieto" htmlFor="adv_note">
                  <Input id="adv_note" name="note" />
                </Field>
                <div>
                  <Button variant="secondary">Tallenna ennakko</Button>
                </div>
              </form>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Hinnat</SectionTitle>
            {prices.length === 0 ? (
              <p className="text-sm text-ink/65">Vesimaksun hintaa ei ole kirjattu.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {prices.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {b.charge_type === "hot_water" ? "Lämmin vesi" : "Vesi"}
                      <span className="block text-xs text-ink/55">
                        {formatDate(b.starts_on)}–{b.ends_on ? formatDate(b.ends_on) : ""}
                      </span>
                    </span>
                    <span className="tabular font-semibold">{formatPrice(b.unit_price)} €/m³</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink/55">
              Hinta kirjataan talouden vastikeperusteisiin: laji Vesimaksu tai Lämmin vesi, peruste Mittarin mukaan. Jos lämpimälle vedelle ei ole omaa hintaa,
              sekin lasketaan vesimaksun hinnalla.
            </p>
            <div className="mt-3">
              <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
                Vastikeperusteisiin
              </LinkButton>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
