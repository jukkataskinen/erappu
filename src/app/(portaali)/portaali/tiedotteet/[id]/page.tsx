import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { markRead } from "@/lib/announcements/queries";
import { audienceText } from "@/lib/announcements/labels";
import { deleteBoardDraft } from "../actions";

export const metadata = { title: "Tiedote" };

export default async function PortalAnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePortal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const companyIds = ctx.companies.map((c) => c.id);

  const a = await ctx.run(async (tx) => {
    const [row] = await tx.query<{
      id: string; company_id: string; company_name: string; title: string; body: string; status: string; origin: string;
      audience_roles: string[]; published_at: string | null; valid_until: string | null; created_at: string; author_user_id: string | null;
    }>(
      `select a.id, a.company_id, c.name as company_name, a.title, a.body, a.status, a.origin, a.audience_roles, a.published_at,
              a.valid_until::text as valid_until, a.created_at, a.author_user_id
         from er_announcements a join er_housing_companies c on c.id = a.company_id
        where a.id = $1 and a.company_id = any($2::uuid[]) and a.status <> 'archived'`,
      [id, companyIds],
    );
    // Avaaminen on lukukuittaus. Kuittaus tallentuu vain julkaistulle tiedotteelle, jonka käyttäjä näkee (RLS).
    if (row?.status === "published") await markRead(tx, row.id, ctx.user.id);
    return row ?? null;
  });
  if (!a) notFound();
  const isBoardDraft = a.status === "draft";
  if (isBoardDraft && !ctx.companies.some((c) => c.id === a.company_id && c.roles.includes("board"))) notFound();

  return (
    <>
      <Link href="/portaali/tiedotteet" className="mb-3 inline-block text-sm text-ink/60 hover:text-ink">
        ← Tiedotteet
      </Link>
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl sm:text-2xl">{a.title}</h1>
          {isBoardDraft ? <Badge tone="warn">Luonnos, odottaa julkaisua</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {a.company_name} · {isBoardDraft ? `laadittu ${formatDate(a.created_at)}` : formatDate(a.published_at)}
          {a.valid_until ? ` · voimassa ${formatDate(a.valid_until)} asti` : ""}
        </p>
        {isBoardDraft ? <p className="mt-1 text-sm text-ink/60">Kohderyhmä: {audienceText(a.audience_roles)}</p> : null}
        <div className="mt-5 whitespace-pre-wrap leading-relaxed">{a.body}</div>
        {isBoardDraft && a.author_user_id === ctx.user.id ? (
          <form action={deleteBoardDraft} className="mt-6">
            <input type="hidden" name="id" value={a.id} />
            <Button variant="secondary">Peru luonnos</Button>
          </form>
        ) : null}
      </Panel>
    </>
  );
}
