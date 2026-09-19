import Link from "next/link";
import { AnnualCycleWheel } from "@/components/AnnualCycleWheel";
import { EmptyState, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { isoDateHelsinki } from "@/lib/format";
import { buildAnnualCycle } from "@/lib/tasks/annual-cycle";

export const metadata = { title: "Vuosikello" };

/** Osakkaille ja asukkaille näytettävät vakiovuosikellon kohdat. Hallitus näkee kaikki. */
const PUBLIC_KEYS = new Set(["general_meeting", "general_meeting_bulletin", "communication_spring", "communication_summer", "communication_autumn", "communication_winter", "winter_preparation"]);

/**
 * Taloyhtiön tavanomainen vuosi ympyränä. Lähteenä vakiovuosikello yhtiön
 * tilikauden mukaan (src/lib/tasks/annual-cycle.ts), ei isännöinnin
 * sisäiset tehtävät: portaalikäyttäjällä ei ole lukuoikeutta er_tasks-tauluun.
 */
export default async function PortalAnnualCyclePage({ searchParams }: { searchParams: Promise<{ yhtio?: string }> }) {
  const ctx = await requirePortal();
  const sp = await searchParams;
  const companies = ctx.companies.filter((c) => c.roles.some((r) => r !== "provider"));
  const company = companies.find((c) => c.id === sp.yhtio) ?? companies[0];

  if (!company) {
    return (
      <>
        <h1 className="text-2xl">Vuosikello</h1>
        <div className="mt-4">
          <EmptyState title="Ei taloyhtiötä">Vuosikello näkyy taloyhtiön osakkaille, asukkaille ja hallitukselle.</EmptyState>
        </div>
      </>
    );
  }

  const [row] = await ctx.run((tx) => tx.query<{ fiscal_year_start: string }>("select fiscal_year_start from er_housing_companies where id = $1", [company.id]));
  const board = company.roles.includes("board");
  const today = isoDateHelsinki();
  const cycle = row ? buildAnnualCycle({ fiscalYearStart: row.fiscal_year_start, today }) : [];
  const items = cycle.filter((t) => board || PUBLIC_KEYS.has(t.key)).map((t) => ({ title: t.title, date: t.due_on, category: t.category }));

  return (
    <>
      <h1 className="text-2xl">Vuosikello</h1>
      <p className="mt-1 text-ink/65">{company.name}</p>

      {companies.length > 1 ? (
        <nav aria-label="Taloyhtiö" className="mt-4 flex flex-wrap gap-2">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/portaali/vuosikello?yhtio=${c.id}`}
              aria-current={c.id === company.id ? "page" : undefined}
              className={`inline-flex min-h-[var(--size-touch)] items-center rounded-full border px-4 text-sm font-semibold ${
                c.id === company.id ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink/75 hover:text-ink"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <Panel className="mt-4">
        <AnnualCycleWheel items={items} caption={board ? "hallituksen näkymä" : "taloyhtiön vuosi"} emptyText="Vuosikelloa ei voitu muodostaa." />
        <p className="mt-5 text-sm text-ink/65">
          Vuosikello näyttää taloyhtiön tavanomaisen vuoden tilikauden mukaan. Päivämäärät ovat viimeisiä ajankohtia; tarkat päivät kerrotaan kokouskutsuissa ja
          tiedotteissa.
        </p>
      </Panel>
    </>
  );
}
