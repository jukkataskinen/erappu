import Link from "next/link";
import { Badge, EmptyState, LinkButton, Notice, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listPortalAnnouncements } from "@/lib/announcements/queries";

export const metadata = { title: "Tiedotteet" };

export default async function PortalAnnouncementsPage({ searchParams }: { searchParams: Promise<{ luonnos?: string }> }) {
  const ctx = await requirePortal();
  const { luonnos } = await searchParams;
  const companyIds = ctx.companies.map((c) => c.id);
  const boardCompanyIds = ctx.companies.filter((c) => c.roles.includes("board")).map((c) => c.id);
  const rows = await ctx.run((tx) => listPortalAnnouncements(tx, ctx.user.id, companyIds, { boardCompanyIds }));
  const drafts = rows.filter((r) => r.status === "draft");
  const published = rows.filter((r) => r.status === "published");
  const multiCompany = ctx.companies.length > 1;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Tiedotteet</h1>
        {boardCompanyIds.length > 0 ? (
          <LinkButton href="/portaali/tiedotteet/uusi" variant="secondary">
            Luonnos isännöitsijälle
          </LinkButton>
        ) : null}
      </div>
      {luonnos ? (
        <div className="mb-4">
          <Notice tone="ok" title="Luonnos lähetetty isännöitsijälle">
            Isännöitsijä tarkistaa tekstin ja julkaisee tiedotteen.
          </Notice>
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg">Hallituksen luonnokset</h2>
          <ul className="grid gap-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/portaali/tiedotteet/${d.id}`} className="block rounded-[var(--radius-panel)] border border-dashed border-line bg-paper p-4 hover:border-ink/25">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.title}</span>
                    <Badge tone="warn">Odottaa julkaisua</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink/60">
                    {multiCompany ? `${d.company_name} · ` : ""}laadittu {formatDate(d.created_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {published.length === 0 ? (
        <EmptyState title="Ei voimassa olevia tiedotteita">Taloyhtiön tiedotteet näkyvät tässä, kun isännöitsijä julkaisee niitä.</EmptyState>
      ) : (
        <ul className="grid gap-3">
          {published.map((a) => (
            <li key={a.id}>
              <Link href={`/portaali/tiedotteet/${a.id}`} className="block">
                <Panel className="hover:border-ink/25">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={a.read_at ? "font-semibold text-ink/80" : "font-bold"}>{a.title}</span>
                    {a.read_at ? null : <Badge tone="info">Uusi</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-ink/60">
                    {multiCompany ? `${a.company_name} · ` : ""}
                    {formatDate(a.published_at)}
                    {a.valid_until ? ` · voimassa ${formatDate(a.valid_until)} asti` : ""}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-ink/75">{a.body}</p>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
