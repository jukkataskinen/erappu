import { Badge, EmptyState, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listDocuments, type DocumentRow } from "@/lib/documents/queries";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, formatBytes } from "@/lib/documents/labels";

export const metadata = { title: "Dokumentit" };

function DocumentList({ rows }: { rows: DocumentRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id}>
          <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noopener" className="flex min-h-[var(--size-touch)] items-center justify-between gap-3 py-2.5 hover:text-sky">
            <span className="min-w-0">
              <span className="block font-semibold">{d.title}</span>
              <span className="block text-xs text-ink/55">
                {d.year ? `${d.year} · ` : ""}
                {formatBytes(d.size_bytes)} · lisätty {formatDate(d.created_at)}
              </span>
            </span>
            <span className="shrink-0 text-sm text-sky">Avaa</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function byCategory(rows: DocumentRow[]) {
  return DOCUMENT_CATEGORIES.map((c) => ({ category: c, rows: rows.filter((r) => r.category === c) })).filter((g) => g.rows.length > 0);
}

/**
 * Portaalin dokumentit. RLS päättää, mitä käyttäjä näkee (näkyvyys, rooli ja
 * huoneisto); sivu vain ryhmittelee. Liitteet (huoltopyyntöjen kuvat) eivät näy tässä.
 */
export default async function PortalDocumentsPage() {
  const ctx = await requirePortal();
  // Sama sääntö kuin RLS:ssä. Toistetaan tässä, koska henkilökuntaan kuuluva
  // portaalikäyttäjä näkee kannasta koko organisaation dokumentit.
  const grants = ctx.user.portal;
  const canSee = (d: DocumentRow) => {
    const roles = grants.filter((g) => g.companyId === d.company_id);
    if (roles.some((g) => g.role === "board")) return ["board", "owners", "residents"].includes(d.visibility);
    if (d.share_group_id) {
      const mine = roles.filter((g) => g.shareGroupId === d.share_group_id);
      return (d.visibility === "owners" && mine.some((g) => g.role === "owner")) || (d.visibility === "residents" && mine.length > 0);
    }
    return (d.visibility === "owners" && roles.some((g) => g.role === "owner")) || (d.visibility === "residents" && roles.some((g) => g.role === "owner" || g.role === "resident"));
  };
  const all = (await ctx.run((tx) => listDocuments(tx, { includeAttachments: false }))).filter(canSee);

  return (
    <>
      <h1 className="mb-5 text-2xl">Dokumentit</h1>
      {all.length === 0 ? (
        <EmptyState title="Ei dokumentteja">Yhtiön yhtiöjärjestys, tilinpäätökset ja muut jaetut asiakirjat näkyvät tässä.</EmptyState>
      ) : (
        <div className="grid gap-6">
          {ctx.companies.map((company) => {
            const rows = all.filter((d) => d.company_id === company.id);
            if (rows.length === 0) return null;
            const own = rows.filter((d) => d.share_group_id);
            const common = rows.filter((d) => !d.share_group_id);
            return (
              <section key={company.id} className="grid gap-4">
                {ctx.companies.length > 1 ? <h2 className="text-lg">{company.name}</h2> : null}
                {own.length > 0 ? (
                  <Panel>
                    <h3 className="mb-1 font-semibold">Oman huoneiston dokumentit</h3>
                    {[...new Set(own.map((d) => d.unit_label))].map((unit) => (
                      <div key={unit ?? "-"} className="mt-2">
                        <Badge>Huoneisto {unit}</Badge>
                        <DocumentList rows={own.filter((d) => d.unit_label === unit)} />
                      </div>
                    ))}
                  </Panel>
                ) : null}
                {byCategory(common).map((g) => (
                  <Panel key={g.category}>
                    <h3 className="mb-1 font-semibold">{CATEGORY_LABEL[g.category]}</h3>
                    <DocumentList rows={g.rows} />
                  </Panel>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
