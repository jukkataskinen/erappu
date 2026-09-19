import Link from "next/link";
import { Badge, DefinitionList, EmptyState, Panel, SectionTitle } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { FormError } from "@/components/FormError";
import { PORTAL_NAV, PORTAL_TABBAR } from "@/config/nav";
import { formatNumber, isoDateHelsinki } from "@/lib/format";
import { BOARD_ROLE, SHARE_GROUP_KIND } from "@/lib/registry/labels";
import { loadPortalHome } from "@/lib/settings/portal-home";
import { portalWaterUnit, type PortalWaterUnit } from "@/lib/water/queries";
import { WaterMeters } from "./WaterMeters";

export const metadata = { title: "Oma huoneisto" };

const UNIT_ROLE: Record<string, string> = { owner: "Osakas", resident: "Asukas" };
const COMPANY_ROLE: Record<string, string> = { board: "Hallitus", owner: "Osakas", resident: "Asukas", provider: "Palveluntuottaja" };

export default async function OwnHomePage({ searchParams }: { searchParams: Promise<{ virhe?: string; vesi?: string }> }) {
  const ctx = await requirePortal();
  const { units, companies } = await loadPortalHome(ctx.db, ctx.user);
  const { virhe, vesi } = await searchParams;
  const today = isoDateHelsinki();
  const water = new Map<string, PortalWaterUnit>();
  await ctx.run(async (tx) => {
    for (const u of units) {
      const w = await portalWaterUnit(tx, u.share_group_id, u.company_id, today);
      if (w) water.set(u.share_group_id, w);
    }
  });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Oma huoneisto</h1>
        <Link href="/portaali/profiili" className="text-sm text-sky">
          Omat tiedot
        </Link>
      </div>
      <FormError message={virhe} />

      {/* Puhelimella alapalkissa on viisi kohtaa; loput portaalin osiot täältä. */}
      <nav aria-label="Portaalin muut osiot" className="mb-8 lg:hidden">
        <ul className="grid grid-cols-2 gap-2">
          {PORTAL_NAV.filter((n) => !PORTAL_TABBAR.some((t) => t.href === n.href)).map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="flex min-h-[var(--size-touch)] items-center rounded-xl border border-line bg-paper px-4 text-sm font-semibold hover:border-sky">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mb-8">
        <SectionTitle>Huoneistot</SectionTitle>
        {units.length === 0 ? (
          <EmptyState title="Ei huoneistoja">Sinulle ei ole kirjattu omistusta tai asumista. Jos tieto on väärin, ota yhteys isännöitsijään.</EmptyState>
        ) : (
          <div className="grid gap-3">
            {units.map((u) => (
              <Panel key={u.share_group_id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-ink/60">{u.company_name}</p>
                    <p className="text-lg font-semibold">{u.unit_label}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r}>{UNIT_ROLE[r]}</Badge>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <DefinitionList
                    items={[
                      { label: "Tyyppi", value: SHARE_GROUP_KIND[u.kind] ?? u.kind },
                      { label: "Huoneistotyyppi", value: u.layout },
                      { label: "Kerros", value: u.floor },
                      { label: "Pinta-ala", value: u.area_m2 ? formatNumber(u.area_m2, "m²") : null },
                      ...(u.ranges
                        ? [
                            { label: "Osakkeita", value: formatNumber(u.share_count) },
                            { label: "Osakenumerot", value: u.ranges.length ? u.ranges.map((r) => `${r.first}–${r.last}`).join(", ") : null },
                          ]
                        : []),
                    ]}
                  />
                </div>
                {water.has(u.share_group_id) ? <WaterMeters unit={water.get(u.share_group_id)!} thanked={vesi === "kiitos"} /> : null}
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Taloyhtiöt</SectionTitle>
        <div className="grid gap-3">
          {companies.map((c) => (
            <Panel key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{c.name}</p>
                  <p className="text-sm text-ink/60">{c.business_id}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.roles.map((r) => (
                    <Badge key={r} tone={r === "board" ? "info" : "neutral"}>
                      {COMPANY_ROLE[r] ?? r}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <DefinitionList
                  items={[
                    { label: "Osoite", value: [c.street_address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null },
                    { label: "Isännöintiyritys", value: c.management?.name ?? null },
                    {
                      label: "Isännöitsijä",
                      value: c.manager ? (
                        <>
                          {c.manager.full_name ?? "–"}
                          {c.manager.email ? (
                            <>
                              <br />
                              <a href={`mailto:${c.manager.email}`} className="text-sky">
                                {c.manager.email}
                              </a>
                            </>
                          ) : null}
                          {c.manager.phone ? (
                            <>
                              <br />
                              <a href={`tel:${c.manager.phone.replace(/\s/g, "")}`} className="text-sky">
                                {c.manager.phone}
                              </a>
                            </>
                          ) : null}
                        </>
                      ) : null,
                    },
                    { label: "Isännöinnin yhteystiedot", value: [c.management?.phone, c.management?.email].filter(Boolean).join(" · ") || null },
                  ]}
                />
              </div>
              {c.board ? (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="mb-2 text-sm font-semibold">Hallitus</p>
                  {c.board.length === 0 ? (
                    <p className="text-sm text-ink/60">Hallitusta ei ole kirjattu.</p>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {c.board.map((b) => (
                        <li key={`${b.party_id}-${b.role}`} className="flex justify-between gap-3 py-2">
                          <span>{b.display_name}</span>
                          <span className="text-ink/60">{BOARD_ROLE[b.role] ?? b.role}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </Panel>
          ))}
        </div>
      </section>
    </>
  );
}
