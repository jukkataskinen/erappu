import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, LinkButton, Notice, Panel, SectionTitle, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { NEED_STATUS_LABEL, PERFORMED_BY_LABEL, WORK_SOURCE_LABEL, type NeedStatus } from "@/lib/maintenance/labels";
import { listNeeds, listNotices, listWorks } from "@/lib/maintenance/queries";
import { OPEN_FOR_OWNER, RENOVATION_STATUS_LABEL, RENOVATION_STATUS_TONE } from "@/lib/maintenance/renovation";
import { isKnownWorkType, WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";
import { addMaintenanceNeed, saveMaintenanceWork, updateMaintenanceNeed } from "./actions";

export const metadata = { title: "Korjaukset" };

const STATE_MESSAGE: Record<string, string> = {
  tyo: "Työ tallennettiin korjaushistoriaan.",
  kpts: "Kunnossapitotarveselvitys päivitettiin.",
  "kpts-valmis": "Rivi merkittiin valmiiksi ja työ siirrettiin korjaushistoriaan.",
};

export default async function RepairsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string; muokkaa?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tila, muokkaa } = await searchParams;
  const company = await loadCompany(ctx, id);
  const year = Number(isoDateHelsinki().slice(0, 4));
  const [works, needs, notices, groups] = await ctx.run(async (tx) => [
    await listWorks(tx, id),
    await listNeeds(tx, id, year, year + 5),
    await listNotices(tx, id),
    await tx.query<{ id: string; unit_label: string }>("select id, unit_label from er_share_groups where company_id = $1 and removed_on is null order by length(unit_label), unit_label", [id]),
  ] as const);
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");
  const editing = muokkaa ? works.find((w) => w.id === muokkaa) ?? null : null;
  const openNotices = notices.filter((n) => OPEN_FOR_OWNER.includes(n.status));
  const closedNotices = notices.filter((n) => !OPEN_FOR_OWNER.includes(n.status));
  const needsByYear = Array.from({ length: 6 }, (_, i) => year + i).map((y) => ({ year: y, rows: needs.filter((n) => n.planned_year === y) }));

  return (
    <>
      <CompanyHeader
        company={company}
        active="korjaukset"
        actions={
          <LinkButton variant="secondary" href={`/taloyhtiot/${id}/htj/yhteenveto`}>
            HTJ2-yhteenveto
          </LinkButton>
        }
      />
      <FormError message={virhe} />
      {tila && STATE_MESSAGE[tila] ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title={STATE_MESSAGE[tila]} />
        </div>
      ) : null}

      <section className="mb-8">
        <SectionTitle>Muutostyöilmoitukset</SectionTitle>
        {notices.length === 0 ? (
          <p className="text-sm text-ink/65">Osakkaat tekevät muutostyöilmoitukset portaalissa. Uudesta ilmoituksesta tulee viesti vastuuisännöitsijälle.</p>
        ) : (
          <>
            {openNotices.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Huoneisto</Th>
                    <Th>Työ</Th>
                    <Th>Suunniteltu</Th>
                    <Th>Tila</Th>
                    <Th>Saapui</Th>
                  </tr>
                </thead>
                <tbody>
                  {openNotices.map((n) => (
                    <tr key={n.id}>
                      <Td className="font-semibold">{n.unit_label}</Td>
                      <Td>
                        <Link href={`/taloyhtiot/${id}/korjaukset/muutostyot/${n.id}`} className="font-semibold hover:text-sky">
                          {n.work_type ?? "Muutostyö"}
                        </Link>
                        <p className="line-clamp-2 text-xs text-ink/65">{n.description}</p>
                      </Td>
                      <Td>{n.planned_start ? `${formatDate(n.planned_start)} – ${formatDate(n.planned_end)}` : "–"}</Td>
                      <Td>
                        <Badge tone={RENOVATION_STATUS_TONE[n.status]}>{RENOVATION_STATUS_LABEL[n.status]}</Badge>
                      </Td>
                      <Td>{formatDate(n.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink/65">Ei käsittelyssä olevia ilmoituksia.</p>
            )}
            {closedNotices.length > 0 ? (
              <details className="mt-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4">
                <summary className="cursor-pointer text-sm font-semibold">Käsitellyt ilmoitukset ({closedNotices.length})</summary>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {closedNotices.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/taloyhtiot/${id}/korjaukset/muutostyot/${n.id}`} className="hover:text-sky">
                        {n.unit_label}: {n.work_type ?? "Muutostyö"}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Badge tone={RENOVATION_STATUS_TONE[n.status]}>{RENOVATION_STATUS_LABEL[n.status]}</Badge>
                        <span className="text-xs text-ink/55">{formatDate(n.completed_on ?? n.decided_on ?? n.updated_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section>
          <SectionTitle>Kunnossapito- ja muutostyöhistoria</SectionTitle>
          {works.length === 0 ? (
            <EmptyState title="Korjaushistoriaa ei ole kirjattu">Kirjaa toteutuneet kunnossapito- ja muutostyöt: hanke, työlaji ja valmistumisvuosi. Ne ilmoitetaan HTJ:hin ja näkyvät isännöitsijäntodistuksessa.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Vuosi</Th>
                  <Th>Hanke</Th>
                  <Th>Työlaji</Th>
                  <Th>Tekijä</Th>
                  <Th numeric>Kustannus</Th>
                  <Th>HTJ</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {works.map((w) => (
                  <tr key={w.id} className={editing?.id === w.id ? "bg-sky-soft/40" : undefined}>
                    <Td className="tabular">{w.completed_year ?? <Badge tone="alert">puuttuu</Badge>}</Td>
                    <Td>
                      <span className="font-semibold">{w.project}</span>
                      {w.description ? <p className="line-clamp-2 text-xs text-ink/60">{w.description}</p> : null}
                      {w.source !== "manual" ? <p className="text-xs text-ink/50">{WORK_SOURCE_LABEL[w.source] ?? w.source}</p> : null}
                    </Td>
                    <Td>{isKnownWorkType(w.work_type) ? w.work_type : <Badge tone="warn">{w.work_type}</Badge>}</Td>
                    <Td>
                      {PERFORMED_BY_LABEL[w.performed_by]}
                      {w.unit_label ? `, ${w.unit_label}` : ""}
                    </Td>
                    <Td numeric>{formatEur(w.cost_eur)}</Td>
                    <Td>{w.htj_submitted_at ? <Badge tone="ok">Ilmoitettu</Badge> : <span className="text-xs text-ink/55">Ei</span>}</Td>
                    <Td>
                      {canWrite ? (
                        <Link href={`/taloyhtiot/${id}/korjaukset?muokkaa=${w.id}#tyo`} className="text-xs text-sky">
                          Muokkaa
                        </Link>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        {canWrite ? (
          <Panel id="tyo">
            <SectionTitle actions={editing ? <Link href={`/taloyhtiot/${id}/korjaukset`} className="text-sm text-ink/60">Peru</Link> : null}>
              {editing ? "Muokkaa työtä" : "Lisää työ"}
            </SectionTitle>
            <form action={saveMaintenanceWork} className="grid gap-4" key={editing?.id ?? "uusi"}>
              <input type="hidden" name="company_id" value={id} />
              <input type="hidden" name="id" value={editing?.id ?? ""} />
              <Field label="Hanke" htmlFor="project">
                <Input id="project" name="project" required maxLength={200} defaultValue={editing?.project ?? ""} placeholder="esim. Vesikaton uusiminen" />
              </Field>
              <Field label="Työlaji" htmlFor="work_type" hint="HTJ:n työlajiluettelon mukaan">
                <Select id="work_type" name="work_type" required defaultValue={editing && isKnownWorkType(editing.work_type) ? editing.work_type : ""}>
                  <option value="" disabled>
                    Valitse
                  </option>
                  {WORK_TYPE_LABELS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valmistumisvuosi" htmlFor="completed_year">
                  <Input id="completed_year" name="completed_year" inputMode="numeric" pattern="\d{4}" defaultValue={editing?.completed_year ?? ""} />
                </Field>
                <Field label="Valmistumispäivä" htmlFor="completed_on">
                  <Input id="completed_on" name="completed_on" type="date" defaultValue={editing?.completed_on ?? ""} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tekijä" htmlFor="performed_by">
                  <Select id="performed_by" name="performed_by" defaultValue={editing?.performed_by ?? "company"}>
                    <option value="company">Yhtiö</option>
                    <option value="shareholder">Osakas</option>
                  </Select>
                </Field>
                <Field label="Huoneisto" htmlFor="share_group_id" hint="Vain osakkaan tai huoneistokohtainen työ">
                  <Select id="share_group_id" name="share_group_id" defaultValue={editing?.share_group_id ?? ""}>
                    <option value="">Koko yhtiö</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.unit_label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Kustannus (€)" htmlFor="cost_eur">
                <Input id="cost_eur" name="cost_eur" inputMode="decimal" defaultValue={editing?.cost_eur ?? ""} />
              </Field>
              <Field label="Kuvaus" htmlFor="description">
                <Textarea id="description" name="description" maxLength={2000} defaultValue={editing?.description ?? ""} />
              </Field>
              {editing?.htj_submitted_at ? <p className="text-xs text-amber">Rivi on ilmoitettu HTJ:hin. Muutoksen jälkeen se ilmoitetaan uudelleen.</p> : null}
              <div>
                <Button variant="secondary">{editing ? "Tallenna muutokset" : "Lisää työ"}</Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>

      <section className="mt-8">
        <SectionTitle>
          Kunnossapitotarveselvitys {year}–{year + 5}
        </SectionTitle>
        <p className="mb-3 text-sm text-ink/65">Hallituksen selvitys yhtiökokoukselle yhtiön kunnossapitotarpeesta seuraavien viiden vuoden aikana. Valmistuneet rivit siirtyvät korjaushistoriaan.</p>
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <Table>
            <thead>
              <tr>
                <Th>Vuosi</Th>
                <Th>Kohde ja toimenpide</Th>
                <Th>Työlaji</Th>
                <Th numeric>Arvio</Th>
                <Th>Tila</Th>
              </tr>
            </thead>
            <tbody>
              {needsByYear.map(({ year: y, rows }) =>
                rows.length === 0 ? (
                  <tr key={y}>
                    <Td className="tabular text-ink/50">{y}</Td>
                    <Td className="text-ink/45">Ei suunniteltuja töitä</Td>
                    <Td />
                    <Td />
                    <Td />
                  </tr>
                ) : (
                  rows.map((n, i) => (
                    <tr key={n.id}>
                      <Td className="tabular">{i === 0 ? y : ""}</Td>
                      <Td>
                        <span className="font-semibold">{n.target}</span>
                        <p className="text-xs text-ink/65">
                          {n.action}
                          {n.affects_residents ? " · vaikuttaa asumiseen" : ""}
                        </p>
                      </Td>
                      <Td>{n.work_type ?? "–"}</Td>
                      <Td numeric>{formatEur(n.estimate_eur)}</Td>
                      <Td>
                        {canWrite && n.status !== "done" && n.status !== "cancelled" ? (
                          <form action={updateMaintenanceNeed} className="flex flex-wrap items-center gap-1">
                            <input type="hidden" name="company_id" value={id} />
                            <input type="hidden" name="id" value={n.id} />
                            <select name="status" defaultValue={n.status} aria-label="Tila" className="rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                              {Object.entries(NEED_STATUS_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                            <input name="planned_year" defaultValue={n.planned_year} aria-label="Vuosi" inputMode="numeric" className="w-16 rounded-lg border border-line bg-paper px-2 py-1 text-sm" />
                            <button className="text-xs font-semibold text-sky">Tallenna</button>
                          </form>
                        ) : (
                          <Badge tone={n.status === "done" ? "ok" : "neutral"}>{NEED_STATUS_LABEL[n.status as NeedStatus] ?? n.status}</Badge>
                        )}
                      </Td>
                    </tr>
                  ))
                ),
              )}
            </tbody>
          </Table>

          {canWrite ? (
            <Panel>
              <SectionTitle>Lisää selvitykseen</SectionTitle>
              <form action={addMaintenanceNeed} className="grid gap-4">
                <input type="hidden" name="company_id" value={id} />
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                  <Field label="Vuosi" htmlFor="planned_year">
                    <Select id="planned_year" name="planned_year" defaultValue={year + 1}>
                      {Array.from({ length: 6 }, (_, i) => year + i).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Kohde" htmlFor="target">
                    <Input id="target" name="target" required maxLength={200} placeholder="esim. Julkisivut" />
                  </Field>
                </div>
                <Field label="Toimenpide" htmlFor="action">
                  <Input id="action" name="action" required maxLength={500} placeholder="esim. Ulkomaalaus" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Työlaji" htmlFor="need_work_type">
                    <Select id="need_work_type" name="work_type" defaultValue="">
                      <option value="">Valitse</option>
                      {WORK_TYPE_LABELS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Kustannusarvio (€)" htmlFor="estimate_eur">
                    <Input id="estimate_eur" name="estimate_eur" inputMode="decimal" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="affects_residents" className="size-4" /> Vaikuttaa asumiseen tai huoneistojen käyttöön
                </label>
                <div>
                  <Button variant="secondary">Lisää</Button>
                </div>
              </form>
            </Panel>
          ) : null}
        </div>
      </section>
    </>
  );
}
