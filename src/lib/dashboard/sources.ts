import "server-only";
import type { StaffContext } from "@/lib/auth/current-user";
import { CONTACT_TOPIC_LABEL } from "@/lib/contacts/labels";
import { listStaffThreads } from "@/lib/contacts/queries";
import { formatEur, isoDateHelsinki } from "@/lib/format";
import { boardHealth, budgetHealth, generalHealth, listGovernanceOverview, statementHealth } from "@/lib/governance/overview";
import { listPendingApprovals } from "@/lib/marketplace/queries";
import { estimateEur } from "@/lib/marketplace/rules";
import type { CompanyListRow } from "@/lib/registry/queries";
import type { DashboardItem, DashboardSource, HealthRow } from "./items";

/**
 * Työpöydän rivit moduuleista, joilla ei ole omaa widget-tiedostoa:
 * yhteydenotot, torin hyväksynnät, vesimittarien lukukierrokset,
 * osakeluettelon tarkistus ja hallinnon asiakirjat.
 */

const day = (ts: string | null | undefined) => (ts ? isoDateHelsinki(new Date(ts)) : null);

export async function contactItems(ctx: StaffContext): Promise<DashboardSource> {
  const [threads, approvals] = await ctx.run(async (tx) => [
    await listStaffThreads(tx, ctx.org.organizationId, { status: "open" }),
    await listPendingApprovals(tx, ctx.org.organizationId),
  ] as const);
  const items: DashboardItem[] = [
    ...threads.map((t) => ({
      id: `yhteydenotto-${t.id}`,
      category: "yhteydenotto" as const,
      title: t.subject,
      companyId: t.company_id,
      companyName: t.company_name,
      context: [t.unit_label, CONTACT_TOPIC_LABEL[t.topic], t.creator_name].filter(Boolean).join(" · "),
      href: `/yhteydenotot/${t.id}`,
      action: "Vastaa",
      dueOn: null,
      waiting: true,
      since: day(t.last_message_at),
    })),
    ...approvals.map((p) => ({
      id: `tori-${p.id}`,
      category: "tori" as const,
      title: `Torivaraus #${p.request_number} odottaa hyväksyntää`,
      companyId: p.company_id,
      companyName: p.company_name,
      context: `${p.provider_name} · arvio ${formatEur(estimateEur(Number(p.estimated_hours), Number(p.hourly_rate_eur)))}, raja ${formatEur(p.limit_eur)}`,
      href: `/huoltopyynnot/${p.request_id}#tori`,
      action: "Hyväksy",
      dueOn: null,
      waiting: true,
      since: day(p.reserved_at),
    })),
  ];
  return { items };
}

/** Avoimet lukukierrokset, joilla on portaali-ilmoitus: määräpäivä ja ilmoitettujen osuus. */
export async function waterItems(ctx: StaffContext): Promise<DashboardSource> {
  const rounds = await ctx.run((tx) =>
    tx.query<{ id: string; company_id: string; company_name: string; read_on: string; report_by: string; meters: number; readings: number }>(
      `select r.id, r.company_id, c.name as company_name, r.read_on::text, r.report_by::text,
              (select count(*)::int from er_water_meters m where m.company_id = r.company_id and m.installed_on <= r.read_on
                 and (m.removed_on is null or m.removed_on > r.read_on)) as meters,
              (select count(*)::int from er_water_readings x where x.round_id = r.id) as readings
         from er_water_reading_rounds r join er_housing_companies c on c.id = r.company_id
        where r.organization_id = $1 and r.status = 'open'
          and not exists (select 1 from er_billing_runs b where b.reading_round_id = r.id and b.status <> 'cancelled')
        order by r.report_by`,
      [ctx.org.organizationId],
    ),
  );
  const items: DashboardItem[] = rounds.map((r) => ({
    id: `vesi-${r.id}`,
    category: "vesi",
    title: r.readings >= r.meters && r.meters > 0 ? "Vesimittarilukemat kirjattu, tee tasauslasku" : `Vesimittarilukemat, ${r.readings}/${r.meters} kirjattu`,
    companyId: r.company_id,
    companyName: r.company_name,
    context: `lukemapäivä ${Number(r.read_on.slice(8))}.${Number(r.read_on.slice(5, 7))}.`,
    href: `/taloyhtiot/${r.company_id}/talous/vesi/lukemat/${r.id}`,
    action: "Lukukierros",
    dueOn: r.report_by,
  }));
  return { items };
}

/**
 * Tietojen kunto: osakeluettelon virheet (punainen) ja hallinnon
 * asiakirjat, joita ei ole tallennettu tai jotka ovat vanhoja (harmaa).
 */
export async function registryHealth(ctx: StaffContext, companies: CompanyListRow[]): Promise<DashboardSource> {
  const governance = await ctx.run((tx) => listGovernanceOverview(tx, ctx.org.organizationId));
  const now = new Date();
  const pick = (f: (r: (typeof governance)[number]) => boolean) => governance.filter(f).map((r) => ({ id: r.company_id, name: r.company_name }));
  const shareIssues = companies.filter((c) => !c.share_checks_off && (c.missing_ranges > 0 || (c.total_shares !== null && c.total_shares !== c.shares_in_units)));
  const health: HealthRow[] = [
    { key: "osakkeet", label: "Osakemäärä tai osakevälit eivät täsmää", companies: shareIssues.map((c) => ({ id: c.id, name: c.name })), href: "/taloyhtiot", tone: "alert" },
    { key: "yhtiokokous", label: "Varsinainen yhtiökokous kirjaamatta tälle vuodelle", companies: pick((r) => generalHealth(r.general, r.next_general, now) === "alert"), href: "/taloyhtiot#hallinto", tone: "neutral" },
    { key: "tilinpaatos", label: "Tilinpäätös puuttuu tai on vanha", companies: pick((r) => statementHealth(r.statement, now) === "alert"), href: "/taloyhtiot#hallinto", tone: "neutral" },
    { key: "talousarvio", label: "Talousarvio puuttuu tai on vanha", companies: pick((r) => budgetHealth(r.budget, now) === "alert"), href: "/taloyhtiot#hallinto", tone: "neutral" },
    { key: "hallitus", label: "Hallituksen kokous kirjaamatta yli vuoteen", companies: pick((r) => boardHealth(r.board, r.next_board, now) === "alert"), href: "/taloyhtiot#hallinto", tone: "neutral" },
  ];
  return { items: [], health };
}
