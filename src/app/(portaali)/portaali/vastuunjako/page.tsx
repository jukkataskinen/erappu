import Link from "next/link";
import { ResponsibilityChart } from "@/components/responsibility/ResponsibilityChart";
import { EmptyState, Notice, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { DUTY_NOTES, GENERAL_DISCLAIMER, LEGAL_SOURCES, ROOMS, URGENT_REPAIR_NOTES, type RoomKey } from "@/lib/responsibility/content";
import { mergeExceptions } from "@/lib/responsibility/merge";
import { listExceptions } from "@/lib/responsibility/queries";

export const metadata = { title: "Vastuunjako" };

/**
 * Osakkaan ja asukkaan vastuunjakotaulukko: "Kuuluuko vika yhtiölle vai minulle?".
 * Palveluntuottajalle taulukkoa ei näytetä (RLS 0094 ei anna poikkeuksia).
 * Jos käyttäjällä on useampi yhtiö, valinta tehdään `yhtio`-parametrilla.
 */
export default async function PortalResponsibilityPage({ searchParams }: { searchParams: Promise<{ yhtio?: string; tila?: string }> }) {
  const ctx = await requirePortal();
  const sp = await searchParams;
  const companies = ctx.companies.filter((c) => c.roles.some((r) => r !== "provider"));
  const company = companies.find((c) => c.id === sp.yhtio) ?? companies[0];
  const initialRoom = ROOMS.some((r) => r.key === sp.tila) ? (sp.tila as RoomKey) : undefined;

  if (!company) {
    return (
      <>
        <h1 className="text-2xl">Vastuunjako</h1>
        <div className="mt-4">
          <EmptyState title="Ei taloyhtiötä">Vastuunjakotaulukko näkyy taloyhtiön osakkaille ja asukkaille.</EmptyState>
        </div>
      </>
    );
  }

  const exceptions = await ctx.run((tx) => listExceptions(tx, company.id));
  const items = mergeExceptions(exceptions);

  return (
    <>
      <h1 className="text-2xl">Kuuluuko vika yhtiölle vai minulle?</h1>
      <p className="mt-1 text-ink/65">Vastuunjako, {company.name}</p>

      {companies.length > 1 ? (
        <nav aria-label="Taloyhtiö" className="mt-4 flex flex-wrap gap-2">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/portaali/vastuunjako?yhtio=${c.id}`}
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

      <div className="mt-4 grid gap-4">
        <Notice tone="info" title="Yleinen tulkinta">
          {GENERAL_DISCLAIMER}
          {exceptions.length > 0 ? " Yhtiösi poikkeukset on merkitty taulukkoon keltaisella." : null}
        </Notice>

        <Panel>
          <ResponsibilityChart items={items} initialRoom={initialRoom} />
        </Panel>

        <Panel>
          <h2 className="text-lg">Kun huomaat vian</h2>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm text-ink/80">
            {DUTY_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <h3 className="mt-5 text-base font-semibold">Kiireellinen vika tai viivästynyt korjaus</h3>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm text-ink/80">
            {URGENT_REPAIR_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/portaali/huoltopyynnot/uusi" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink-strong">
              Tee huoltopyyntö
            </Link>
            <Link href="/portaali/muutostyot" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-line bg-paper px-5 text-sm font-semibold text-ink hover:border-ink/30">
              Muutostyöilmoitukset
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink/55">Lähteet: {LEGAL_SOURCES[0]}.</p>
        </Panel>
      </div>
    </>
  );
}
