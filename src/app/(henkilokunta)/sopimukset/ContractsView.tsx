import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Button, EmptyState, Field, LinkButton, Select, Stat, Table, Td, Th } from "@/components/ui";
import type { StaffContext } from "@/lib/auth/current-user";
import { contractTiming } from "@/lib/contracts/deadlines";
import { CONTRACT_CATEGORIES, CONTRACT_CATEGORY_LABEL, CONTRACT_STATUS_LABEL, type ContractCategory } from "@/lib/contracts/labels";
import { listContracts } from "@/lib/contracts/queries";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";

export type ContractsSearch = { yhtio?: string; luokka?: string; tila?: string };

/**
 * Sopimusrekisteri koko organisaatiolle tai yhdelle yhtiölle. `basePath` on
 * sivun oma osoite, jotta suodattimet ja tilastolinkit pysyvät samassa näkymässä.
 */
export async function ContractsView({
  ctx,
  sp,
  fixedCompanyId,
  basePath,
  header,
}: {
  ctx: StaffContext;
  sp: ContractsSearch;
  fixedCompanyId?: string;
  basePath: string;
  header: (info: { newHref: string; canWrite: boolean }) => ReactNode;
}) {
  const today = isoDateHelsinki();
  const companyId = fixedCompanyId ?? (sp.yhtio && /^[0-9a-f-]{36}$/i.test(sp.yhtio) ? sp.yhtio : null);
  const category = (CONTRACT_CATEGORIES as readonly string[]).includes(sp.luokka ?? "") ? (sp.luokka as ContractCategory) : null;
  const tila = ["voimassa", "paattymassa", "paattyneet", "kaikki"].includes(sp.tila ?? "") ? sp.tila! : "voimassa";

  const [companies, all] = await ctx.run((tx) =>
    Promise.all([
      fixedCompanyId ? Promise.resolve([]) : listCompanies(tx, ctx.org.organizationId),
      listContracts(tx, { organizationId: ctx.org.organizationId, companyId, category }),
    ]),
  );
  const rows = all.map((c) => ({ ...c, timing: contractTiming(c, today) }));
  const visible = rows.filter((c) =>
    tila === "kaikki" ? true :
    tila === "paattyneet" ? c.timing.effectiveStatus === "ended" :
    tila === "paattymassa" ? c.timing.endingSoon :
    c.timing.effectiveStatus !== "ended",
  );
  const active = rows.filter((c) => c.timing.effectiveStatus !== "ended");
  const endingSoon = rows.filter((c) => c.timing.endingSoon);
  const annual = active.reduce((s, c) => s + Number(c.annual_cost_eur ?? 0), 0);
  const canWrite = ctx.can("owner", "manager", "assistant");
  const newHref = `/sopimukset/uusi${companyId ? `?yhtio=${companyId}` : ""}`;

  return (
    <>
      {header({ newHref, canWrite })}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Voimassa" value={active.length} href={basePath} />
        <Stat label="Päättymässä 90 päivän sisällä" value={endingSoon.length} tone={endingSoon.length ? "warn" : "ok"} href={`${basePath}?tila=paattymassa`} />
        <Stat label="Vuosikustannukset yhteensä" value={formatEur(annual)} />
      </div>

      <form method="get" className={`mt-6 grid gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:grid-cols-2 lg:items-end ${fixedCompanyId ? "lg:grid-cols-[1fr_1fr_auto]" : "lg:grid-cols-[1.4fr_1fr_1fr_auto]"}`}>
        {fixedCompanyId ? null : (
          <Field label="Yhtiö" htmlFor="f_yhtio">
            <Select id="f_yhtio" name="yhtio" defaultValue={companyId ?? ""}>
              <option value="">Kaikki yhtiöt</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Luokka" htmlFor="f_luokka">
          <Select id="f_luokka" name="luokka" defaultValue={category ?? ""}>
            <option value="">Kaikki</option>
            {CONTRACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CONTRACT_CATEGORY_LABEL[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tila" htmlFor="f_tila">
          <Select id="f_tila" name="tila" defaultValue={tila}>
            <option value="voimassa">Voimassa olevat</option>
            <option value="paattymassa">Päättymässä 90 pv</option>
            <option value="paattyneet">Päättyneet</option>
            <option value="kaikki">Kaikki</option>
          </Select>
        </Field>
        <Button variant="secondary">Suodata</Button>
      </form>

      <div className="mt-6">
        {visible.length === 0 ? (
          <EmptyState title="Ei sopimuksia" action={canWrite ? <LinkButton href={newHref}>Lisää sopimus</LinkButton> : null}>
            Kirjaa vakuutukset, huolto-, siivous- ja energiasopimukset, niin irtisanomisen viimeinen päivä ja muistutus lasketaan automaattisesti.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                {fixedCompanyId ? null : <Th>Yhtiö</Th>}
                <Th>Vastapuoli</Th>
                <Th>Päättyy</Th>
                <Th>Irtisanomisaika</Th>
                <Th numeric>Vuosikustannus</Th>
                <Th>Tila</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const t = c.timing;
                return (
                  <tr key={c.id} className={t.endingSoon ? "bg-amber-soft/50" : "hover:bg-cloud/50"}>
                    {fixedCompanyId ? null : <Td>{c.company_name}</Td>}
                    <Td>
                      <Link href={`/sopimukset/${c.id}`} className="font-semibold hover:text-sky">{c.counterparty}</Link>
                      <span className="block text-xs text-ink/55">{CONTRACT_CATEGORY_LABEL[c.category]}</span>
                    </Td>
                    <Td>
                      {c.ends_on ? formatDate(c.ends_on) : <span className="text-ink/55">Toistaiseksi</span>}
                      {t.daysToEnd !== null && t.daysToEnd >= 0 && t.daysToEnd <= 90 ? <span className="block text-xs text-amber">{t.daysToEnd} pv</span> : null}
                    </Td>
                    <Td>
                      {c.notice_months !== null ? `${c.notice_months} kk` : "–"}
                      {t.deadline ? (
                        <span className={`block text-xs ${t.noticePassed ? "text-ink/45" : t.endingSoon ? "font-semibold text-amber" : "text-ink/55"}`}>
                          viimeistään {formatDate(t.deadline)}
                        </span>
                      ) : null}
                    </Td>
                    <Td numeric>{formatEur(c.annual_cost_eur)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={t.effectiveStatus === "ended" ? "neutral" : t.effectiveStatus === "ending" ? "warn" : "ok"}>{CONTRACT_STATUS_LABEL[t.effectiveStatus]}</Badge>
                        {t.endingSoon ? <Badge tone="warn">Päättymässä</Badge> : null}
                        {t.noticePassed ? <Badge tone="neutral">Irtisanomisaika mennyt</Badge> : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
