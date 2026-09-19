import Link from "next/link";
import { Badge, PageHeader, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import {
  buildAgenda,
  CATEGORY_LABEL,
  collapseGroups,
  dueLabel,
  inScope,
  scopeHealth,
  UPCOMING_DAYS,
  type DashboardItem,
  type DashboardSource,
  type ItemCategory,
} from "@/lib/dashboard/items";
import { contactItems, registryHealth, waterItems } from "@/lib/dashboard/sources";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { diffDays } from "@/lib/tasks/dates";
import * as arki from "@/widgets/arki";
import * as htj from "@/widgets/htj";
import * as huolto from "@/widgets/huolto";
import * as kokoukset from "@/widgets/kokoukset";
import * as talous from "@/widgets/talous";
import * as viestinta from "@/widgets/viestinta";

export const metadata = { title: "Työpöytä" };

/**
 * Työpöytä kiireellisyyden mukaan (Jukka 19.9.2026): toimintaa vaativat
 * luvut, yhteinen tehtävälista kaikista moduuleista, 60 päivän aikajana ja
 * tietojen kunto. Hallinnon yhtiökohtainen taulukko on Taloyhtiöt-sivulla.
 */

const MAX_TASKS = 12;
/** Nämä mainitaan "Ei avoimia" -rivillä, kun niitä ei ole. */
const QUIET: ItemCategory[] = ["yhteydenotto", "huolto", "muutostyo", "tori"];
const QUIET_LABEL: Partial<Record<ItemCategory, string>> = { yhteydenotto: "yhteydenotot", huolto: "huoltopyynnöt", muutostyo: "muutostyöilmoitukset", tori: "torihyväksynnät" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("fi-FI", { hour: "numeric", hour12: false, timeZone: "Europe/Helsinki" }).format(new Date()));
  if (h < 10) return "Hyvää huomenta";
  if (h < 17) return "Hyvää päivää";
  return "Hyvää iltaa";
}

const LABEL_TONE = { alert: "bg-coral-soft text-coral", warn: "bg-amber-soft text-amber", neutral: "bg-cloud text-ink/65" } as const;

function TaskRow({ item, today }: { item: DashboardItem; today: string }) {
  const due = dueLabel(item, today);
  return (
    <li className="flex items-start gap-3 py-2.5 sm:items-center">
      <span className={`tabular mt-0.5 min-w-[5.5rem] shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-semibold sm:mt-0 ${LABEL_TONE[due.tone]}`}>{due.text}</span>
      <Link href={item.href} className="min-w-0 flex-1 hover:text-sky">
        <span className="block font-semibold sm:truncate">{item.title}</span>
        <span className="line-clamp-2 text-sm text-ink/60 sm:block sm:truncate">
          {[CATEGORY_LABEL[item.category], item.companyName, item.context].filter(Boolean).join(" · ")}
        </span>
      </Link>
      <Link href={item.href} className="hidden shrink-0 text-sm font-semibold text-sky sm:inline">
        {item.action}
      </Link>
    </li>
  );
}

function Timeline({ items, today }: { items: DashboardItem[]; today: string }) {
  return (
    <div className="relative mt-2 mb-7 h-4" aria-hidden>
      <div className="absolute inset-x-0 top-2 border-t border-line" />
      {items.map((i) => {
        const left = Math.min(100, Math.max(0, (diffDays(today, i.dueOn!) / UPCOMING_DAYS) * 100));
        return (
          <span
            key={i.id}
            title={`${formatDate(i.dueOn)} ${i.title}${i.companyName ? `, ${i.companyName}` : ""}`}
            className={`absolute top-0.5 size-3 -translate-x-1/2 rounded-full ${i.event ? "bg-sky" : "border-2 border-ink/40 bg-paper"}`}
            style={{ left: `${left}%` }}
          />
        );
      })}
      <span className="absolute top-5 left-0 text-xs text-ink/50">tänään</span>
      <span className="absolute top-5 right-0 text-xs text-ink/50">{UPCOMING_DAYS} pv</span>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ nayta?: string; kaikki?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const today = isoDateHelsinki();
  const companies = await ctx.run((tx) => listCompanies(tx, ctx.org.organizationId));
  const mine = new Set(companies.filter((c) => c.manager_user_id === ctx.user.id).map((c) => c.id));
  const scopeMine = mine.size > 0 && sp.nayta !== "kaikki";
  const scope = scopeMine ? mine : null;

  const sources: DashboardSource[] = await Promise.all([
    contactItems(ctx),
    huolto.dashboardItems(ctx),
    htj.dashboardItems(ctx),
    talous.dashboardItems(ctx),
    kokoukset.dashboardItems(ctx),
    arki.dashboardItems(ctx),
    viestinta.dashboardItems(ctx),
    waterItems(ctx),
    registryHealth(ctx, companies),
  ]);
  const scoped = inScope(
    sources.flatMap((s) => s.items),
    scope,
  );
  const agenda = buildAgenda(collapseGroups(scoped), today);
  const health = scopeHealth(
    sources.flatMap((s) => s.health ?? []),
    scope,
  ).sort((a, b) => (a.tone === "alert" ? 0 : 1) - (b.tone === "alert" ? 0 : 1));
  const billingMissing = sources.flatMap((s) => s.billingMissing ?? []).filter((id) => !scope || scope.has(id)).length;
  const quiet = QUIET.filter((c) => !scoped.some((i) => i.category === c));
  const shownTasks = sp.kaikki === "1" ? agenda.tasks : agenda.tasks.slice(0, MAX_TASKS);
  const firstName = ctx.user.fullName?.split(" ")[0];
  const weekday = new Intl.DateTimeFormat("fi-FI", { weekday: "long", timeZone: "Europe/Helsinki" }).format(new Date());
  const scopeLink = (value: "omat" | "kaikki") => (value === "kaikki" ? "/tyopoyta?nayta=kaikki" : "/tyopoyta");

  return (
    <>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={`${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatDate(today)} · ${ctx.org.organizationName}`}
        actions={
          mine.size > 0 ? (
            <nav aria-label="Näytettävät yhtiöt" className="inline-flex overflow-hidden rounded-full border border-line text-sm">
              <Link href={scopeLink("omat")} aria-current={scopeMine ? "page" : undefined} className={`px-4 py-1.5 ${scopeMine ? "bg-ink font-semibold text-paper" : "bg-paper text-ink/70 hover:text-ink"}`}>
                Omat yhtiöt ({mine.size})
              </Link>
              <Link href={scopeLink("kaikki")} aria-current={!scopeMine ? "page" : undefined} className={`px-4 py-1.5 ${!scopeMine ? "bg-ink font-semibold text-paper" : "bg-paper text-ink/70 hover:text-ink"}`}>
                Kaikki ({companies.length})
              </Link>
            </nav>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Odottaa vastaustasi" value={agenda.waiting} tone={agenda.waiting ? "warn" : "ok"} href="#tehtavaa" />
        <Stat label="Myöhässä" value={agenda.overdue} tone={agenda.overdue ? "alert" : "ok"} href="#tehtavaa" />
        <Stat label="Tällä viikolla" value={agenda.thisWeek} tone={agenda.thisWeek ? "warn" : undefined} href="#tehtavaa" />
        <Stat label="Vastikeajot tekemättä" value={billingMissing} tone={billingMissing ? "warn" : "ok"} href="/talous" />
      </div>

      <Panel id="tehtavaa" className="mt-6">
        <SectionTitle actions={<span className="text-sm text-ink/55">kiireellisin ensin</span>}>Tehtävää</SectionTitle>
        {agenda.tasks.length === 0 ? (
          <p className="text-sm text-ink/65">Ei tehtäviä kahden viikon sisällä.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shownTasks.map((i) => (
              <TaskRow key={i.id} item={i} today={today} />
            ))}
          </ul>
        )}
        {agenda.tasks.length > shownTasks.length ? (
          <p className="mt-2 text-sm">
            <Link href={`/tyopoyta?${new URLSearchParams({ ...(sp.nayta ? { nayta: sp.nayta } : {}), kaikki: "1" }).toString()}#tehtavaa`} className="font-semibold text-sky">
              Näytä kaikki {agenda.tasks.length}
            </Link>
          </p>
        ) : null}
        {quiet.length > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-sm text-ink/60">
            <span className="text-moss">✓</span> Ei avoimia: {quiet.map((c) => QUIET_LABEL[c]).join(", ")}
          </p>
        ) : null}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <SectionTitle actions={<Link href="/vuosikello" className="text-sm text-sky">Vuosikello</Link>}>Tulossa {UPCOMING_DAYS} päivän sisällä</SectionTitle>
          {agenda.upcoming.length === 0 ? (
            <p className="text-sm text-ink/65">Ei kokouksia eikä määräaikoja.</p>
          ) : (
            <>
              <Timeline items={agenda.upcoming} today={today} />
              <ul className="divide-y divide-line text-sm">
                {agenda.upcoming.map((i) => (
                  <li key={i.id} className="flex items-baseline gap-3 py-2">
                    <span className={`tabular w-14 shrink-0 ${i.event ? "font-semibold text-sky" : "text-ink/60"}`}>{dueLabel(i, today).text}</span>
                    <Link href={i.href} className="min-w-0 flex-1 hover:text-sky">
                      <span className={i.event ? "font-semibold" : ""}>{i.title}</span>
                      {i.companyName ? <span className="block truncate text-ink/55">{i.companyName}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink/50">Täytetty piste on kokous, rengas määräaika.</p>
            </>
          )}
        </Panel>

        <Panel>
          <SectionTitle actions={<span className="text-sm text-ink/55">ei kiireellistä</span>}>Tietojen kunto</SectionTitle>
          {health.length === 0 ? (
            <p className="text-sm text-ink/65">Rekisterissä ei ole korjattavaa.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {health.map((h) => (
                <li key={h.key} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span>{h.label}</span>
                      <Badge tone={h.tone === "alert" ? "alert" : "neutral"}>{h.companies.length === 1 ? "1 yhtiö" : `${h.companies.length} yhtiötä`}</Badge>
                    </summary>
                    <ul className="mt-2 grid gap-1 pl-2 text-ink/70">
                      {h.companies.map((c) => (
                        <li key={c.id}>
                          <Link href={`/taloyhtiot/${c.id}`} className="hover:text-sky">
                            {c.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={h.href} className="mt-1 inline-block pl-2 text-xs font-semibold text-sky">
                      Avaa
                    </Link>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
