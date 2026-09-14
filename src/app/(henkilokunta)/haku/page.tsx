import Link from "next/link";
import { Badge, Button, EmptyState, Input, PageHeader, Panel } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { searchRegistry } from "@/lib/registry/search";

export const metadata = { title: "Haku" };

const KIND = { company: "Taloyhtiö", unit: "Huoneisto", party: "Henkilö" } as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireStaff();
  const { q = "" } = await searchParams;
  const hits = q.trim().length >= 2 ? await ctx.run((tx) => searchRegistry(tx, ctx.org.organizationId, q)) : [];

  return (
    <>
      <PageHeader title="Haku" subtitle="Taloyhtiöt, huoneistot ja henkilöt. Huoneiston löydät kirjoittamalla yhtiön nimen ja huoneiston tunnuksen, esim. Jussilantie 3." />
      <form className="mb-6 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Hakusana
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Hae…" autoFocus />
        <Button>Hae</Button>
      </form>
      {q.trim().length < 2 ? null : hits.length === 0 ? (
        <EmptyState title="Ei tuloksia">Tarkista kirjoitusasu tai kokeile osaa nimestä.</EmptyState>
      ) : (
        <Panel className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <Link href={h.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-cloud/50">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{h.title}</span>
                    <span className="block truncate text-sm text-ink/55">{h.subtitle}</span>
                  </span>
                  <Badge>{KIND[h.kind]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
