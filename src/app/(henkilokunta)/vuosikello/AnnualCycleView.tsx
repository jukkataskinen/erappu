import Link from "next/link";
import type { ReactNode } from "react";
import { AnnualCycleWheel } from "@/components/AnnualCycleWheel";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, LinkButton, Notice, Panel, SectionTitle, Select, Stat } from "@/components/ui";
import type { StaffContext } from "@/lib/auth/current-user";
import { formatDateTime, isoDateHelsinki } from "@/lib/format";
import { listCompanies, listStaff } from "@/lib/registry/queries";
import { addDays, addMonths, diffDays, finnishMonthName, finnishWeekdayShort, monthKey, parseIsoDate, shortFinnishDate, startOfWeek, toIsoDate } from "@/lib/tasks/dates";
import { TASK_CATEGORIES, TASK_CATEGORY_LABEL, type TaskCategory } from "@/lib/tasks/labels";
import { listRecentlyDone, listTasks, type TaskRow } from "@/lib/tasks/queries";
import { describeRecurrence } from "@/lib/tasks/recurrence";
import { completeTaskAction, createAnnualCycleAction } from "./actions";

export type AnnualCycleSearch = { yhtio?: string; luokka?: string; vastuu?: string; myohassa?: string; kuitatut?: string; virhe?: string; luotu?: string };

const isUuid = (v: string | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);

/**
 * Vuosikello koko organisaatiolle tai yhdelle yhtiölle (`fixedCompanyId`).
 * `basePath` on sivun oma osoite: suodattimet, kuittauksen paluu ja
 * vakiovuosikellon luonti pysyvät samassa näkymässä.
 */
export async function AnnualCycleView({
  ctx,
  sp,
  fixedCompanyId,
  basePath,
  header,
}: {
  ctx: StaffContext;
  sp: AnnualCycleSearch;
  fixedCompanyId?: string;
  basePath: string;
  header: (info: { newHref: string }) => ReactNode;
}) {
  const today = isoDateHelsinki();
  const companyId = fixedCompanyId ?? (isUuid(sp.yhtio) ? sp.yhtio! : null);
  const category = (TASK_CATEGORIES as readonly string[]).includes(sp.luokka ?? "") ? (sp.luokka as TaskCategory) : null;
  const assignee = sp.vastuu === "oma" ? ctx.user.id : isUuid(sp.vastuu) ? sp.vastuu! : null;
  const overdueOnly = sp.myohassa === "1";
  const firstMonth = toIsoDate(parseIsoDate(today).year, parseIsoDate(today).month, 1);
  const until = addDays(addMonths(firstMonth, 12), -1);

  const [companies, staff, tasks, done] = await ctx.run((tx) =>
    Promise.all([
      fixedCompanyId ? Promise.resolve([]) : listCompanies(tx, ctx.org.organizationId),
      listStaff(tx, ctx.org.organizationId),
      listTasks(tx, { organizationId: ctx.org.organizationId, companyId, category, assigneeUserId: assignee, overdueOnly, today, until }),
      sp.kuitatut === "1" ? listRecentlyDone(tx, ctx.org.organizationId, 30, companyId) : Promise.resolve([] as TaskRow[]),
    ]),
  );

  const overdue = tasks.filter((t) => t.due_on < today);
  const upcoming = tasks.filter((t) => t.due_on >= today);
  const weekEnd = addDays(startOfWeek(today), 6);
  const thisWeek = upcoming.filter((t) => t.due_on <= weekEnd).length;
  const next30 = upcoming.filter((t) => diffDays(today, t.due_on) <= 30).length;
  const filterQuery = new URLSearchParams(Object.entries({ yhtio: fixedCompanyId ? undefined : sp.yhtio, luokka: sp.luokka, vastuu: sp.vastuu, myohassa: sp.myohassa }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `${basePath}${filterQuery ? `?${filterQuery}` : ""}`;
  const newHref = `/vuosikello/uusi${companyId ? `?yhtio=${companyId}` : ""}`;

  const months = Array.from({ length: 12 }, (_, i) => addMonths(firstMonth, i));
  const byMonth = new Map<string, TaskRow[]>();
  for (const t of upcoming) byMonth.set(monthKey(t.due_on), [...(byMonth.get(monthKey(t.due_on)) ?? []), t]);

  return (
    <>
      {header({ newHref })}
      <FormError message={sp.virhe} />
      {sp.luotu !== undefined ? (
        <div className="mb-5">
          <Notice tone="ok" title={Number(sp.luotu) > 0 ? `Vuosikelloon lisättiin ${sp.luotu} tehtävää` : "Yhtiöllä on jo vakiovuosikello"}>
            {Number(sp.luotu) > 0 ? "Tarkista eräpäivät ja vastuuhenkilöt." : "Avoimia pohjatehtäviä ei luotu uudelleen."}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Myöhässä" value={overdue.length} tone={overdue.length ? "alert" : "ok"} href={`${basePath}?myohassa=1`} />
        <Stat label="Tällä viikolla" value={thisWeek} />
        <Stat label="Seuraavat 30 päivää" value={next30} />
      </div>

      {fixedCompanyId && !category && !assignee && !overdueOnly && upcoming.length > 0 ? (
        <Panel className="mt-6">
          <SectionTitle>Vuosi yhdellä silmäyksellä</SectionTitle>
          <AnnualCycleWheel
            caption={`alkaen ${parseIsoDate(firstMonth).month}/${parseIsoDate(firstMonth).year}`}
            items={upcoming.map((t) => ({ title: t.title, date: t.due_on, category: t.category, href: `/vuosikello/${t.id}` }))}
          />
        </Panel>
      ) : null}

      <form
        method="get"
        className={`mt-6 grid gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:grid-cols-2 lg:items-end ${fixedCompanyId ? "lg:grid-cols-[1fr_1fr_auto_auto]" : "lg:grid-cols-[1.4fr_1fr_1fr_auto_auto]"}`}
      >
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
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>{TASK_CATEGORY_LABEL[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vastuuhenkilö" htmlFor="f_vastuu">
          <Select id="f_vastuu" name="vastuu" defaultValue={sp.vastuu ?? ""}>
            <option value="">Kaikki</option>
            <option value="oma">Minun tehtäväni</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <label className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="myohassa" value="1" defaultChecked={overdueOnly} className="size-5" />
          Vain myöhässä
        </label>
        <div className="flex gap-2">
          <Button variant="secondary">Suodata</Button>
          {filterQuery ? <LinkButton variant="ghost" href={basePath}>Tyhjennä</LinkButton> : null}
        </div>
      </form>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-6">
          {overdue.length > 0 ? (
            <Panel className="border-coral/40">
              <SectionTitle>Myöhässä</SectionTitle>
              <TaskList tasks={overdue} today={today} back={back} showCompany={!fixedCompanyId} />
            </Panel>
          ) : null}

          {!overdueOnly && tasks.length === 0 ? (
            <EmptyState title="Ei tehtäviä seuraavalle 12 kuukaudelle" action={fixedCompanyId || companies[0] ? null : <LinkButton href="/taloyhtiot">Lisää taloyhtiö</LinkButton>}>
              Luo yhtiölle vakiovuosikello, niin tilinpäätös, yhtiökokous, hallituksen kokoukset, asukastiedotteet, HTJ-päivitys ja vakuutusten tarkistus tulevat listalle.
            </EmptyState>
          ) : null}

          {!overdueOnly && tasks.length > 0
            ? months.map((m) => {
                const items = byMonth.get(monthKey(m)) ?? [];
                const { year, month } = parseIsoDate(m);
                return (
                  <section key={m} aria-labelledby={`kk-${m}`}>
                    <h2 id={`kk-${m}`} className="mb-2 flex items-baseline gap-2 text-lg">
                      <span className="capitalize">{finnishMonthName(month)}</span>
                      <span className="text-sm font-normal text-ink/50">{year}</span>
                      <span className="ml-auto text-sm font-normal text-ink/50">{items.length ? `${items.length} kpl` : ""}</span>
                    </h2>
                    {items.length ? (
                      <div className="rounded-[var(--radius-panel)] border border-line bg-paper px-4">
                        <TaskList tasks={items} today={today} back={back} showCompany={!fixedCompanyId} />
                      </div>
                    ) : (
                      <p className="rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-3 text-sm text-ink/45">Ei tehtäviä</p>
                    )}
                  </section>
                );
              })
            : overdueOnly && overdue.length === 0 ? <EmptyState title="Ei myöhässä olevia tehtäviä" /> : null}

          <div>
            {sp.kuitatut === "1" ? (
              <Panel>
                <SectionTitle>Viimeksi kuitatut</SectionTitle>
                {done.length === 0 ? (
                  <p className="text-sm text-ink/60">Ei kuitattuja tehtäviä.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {done.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                        <Link href={`/vuosikello/${t.id}`} className="font-semibold hover:text-sky">{t.title}</Link>
                        <span className="text-ink/60">
                          {t.company_name && !fixedCompanyId ? `${t.company_name} · ` : ""}
                          {formatDateTime(t.done_at)}
                          {t.done_by_name ? `, ${t.done_by_name}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : (
              <Link href={`${back}${back.includes("?") ? "&" : "?"}kuitatut=1`} className="text-sm text-sky">Näytä viimeksi kuitatut</Link>
            )}
          </div>
        </div>

        <aside className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Luo yhtiön vakiovuosikello</SectionTitle>
            <p className="mb-4 text-sm text-ink/65">
              Tilikaudesta lasketaan tilinpäätös, tilin- tai toiminnantarkastus, kunnossapitotarveselvitys, varsinainen yhtiökokous (viimeistään 6 kk
              tilikauden päättymisestä), hallituksen kokoukset talvella, keväällä, järjestäytymiskokous, kesällä ja syksyllä, yhtiökokoustiedote,
              HTJ-päivitys, vakuutusten tarkistus ja energiatodistus. Vuodenaikojen mukaan tulevat asukastiedotteet ja talveen varautuminen. Jo
              olemassa olevia ei luoda uudelleen, joten napilla voi lisätä myös uudet tehtävät aiemmin luotuun vuosikelloon.
            </p>
            <form action={createAnnualCycleAction} className="grid gap-3">
              <input type="hidden" name="back" value={basePath} />
              {fixedCompanyId ? (
                <input type="hidden" name="company_id" value={fixedCompanyId} />
              ) : (
                <Field label="Yhtiö" htmlFor="cycle_company">
                  <Select id="cycle_company" name="company_id" required defaultValue={companyId ?? ""}>
                    <option value="" disabled>Valitse yhtiö</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Vastuuhenkilö" htmlFor="cycle_assignee" hint="Oletuksena yhtiön isännöitsijä.">
                <Select id="cycle_assignee" name="assignee_user_id" defaultValue="">
                  <option value="">Yhtiön isännöitsijä</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button variant="secondary" disabled={!fixedCompanyId && companies.length === 0}>Luo vuosikello</Button>
              </div>
            </form>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function TaskList({ tasks, today, back, showCompany }: { tasks: TaskRow[]; today: string; back: string; showCompany: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const late = t.due_on < today;
        const days = diffDays(today, t.due_on);
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className={`tabular w-16 shrink-0 text-sm ${late ? "font-semibold text-coral" : "text-ink/70"}`}>
              <span className="block">{shortFinnishDate(t.due_on)}</span>
              <span className="block text-xs">{late ? `${-days} pv myöhässä` : days === 0 ? "tänään" : finnishWeekdayShort(t.due_on)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/vuosikello/${t.id}`} className="font-semibold hover:text-sky">{t.title}</Link>
              <p className="text-sm text-ink/60">
                {[showCompany ? (t.company_name ?? "Toimisto") : null, t.assignee_name, t.recurrence ? describeRecurrence(t.recurrence).toLowerCase() : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Badge tone={t.category === "general_meeting" ? "info" : t.category === "htj_update" ? "warn" : "neutral"}>{TASK_CATEGORY_LABEL[t.category]}</Badge>
            <form action={completeTaskAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="back" value={back} />
              <Button variant="secondary" className="min-h-9 px-4" aria-label={`Kuittaa tehdyksi: ${t.title}`}>Kuittaa</Button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
