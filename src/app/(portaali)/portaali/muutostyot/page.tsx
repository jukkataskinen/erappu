import Link from "next/link";
import { Badge, EmptyState, LinkButton, Notice, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listPortalNotices, type NoticeRow } from "@/lib/maintenance/queries";
import { RENOVATION_STATUS_LABEL, RENOVATION_STATUS_TONE } from "@/lib/maintenance/renovation";

export const metadata = { title: "Muutostyöt" };

function NoticeCard({ n, showCompany }: { n: NoticeRow; showCompany: boolean }) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{n.work_type ?? "Muutostyö"}</p>
          <p className="text-sm text-ink/60">
            {showCompany ? `${n.company_name}, ` : ""}huoneisto {n.unit_label} · {formatDate(n.created_at)}
          </p>
        </div>
        <Badge tone={RENOVATION_STATUS_TONE[n.status]}>{RENOVATION_STATUS_LABEL[n.status]}</Badge>
      </div>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{n.description}</p>
      {n.planned_start ? (
        <p className="mt-2 text-xs text-ink/60">
          Suunniteltu {formatDate(n.planned_start)} – {formatDate(n.planned_end)}
        </p>
      ) : null}
      {n.conditions ? (
        <div className="mt-3">
          <Notice tone="info" title="Ehdot">
            <p className="whitespace-pre-wrap">{n.conditions}</p>
          </Notice>
        </div>
      ) : null}
      {n.supervisor ? <p className="mt-2 text-xs text-ink/60">Valvoja: {n.supervisor}</p> : null}
      {n.decided_on || n.completed_on ? (
        <p className="mt-1 text-xs text-ink/60">
          {n.decided_on ? `Päätös ${formatDate(n.decided_on)}` : ""}
          {n.completed_on ? ` · valmistui ${formatDate(n.completed_on)}` : ""}
        </p>
      ) : null}
    </Panel>
  );
}

export default async function PortalRenovationsPage({ searchParams }: { searchParams: Promise<{ tila?: string }> }) {
  const ctx = await requirePortal();
  const { tila } = await searchParams;
  const notices = await ctx.run((tx) => listPortalNotices(tx));
  const ownGroups = new Set(ctx.user.portal.filter((g) => (g.role === "owner" || g.role === "resident") && g.shareGroupId).map((g) => g.shareGroupId));
  const canSubmit = ctx.user.portal.some((g) => g.role === "owner" && g.shareGroupId);
  const own = notices.filter((n) => ownGroups.has(n.share_group_id));
  const others = notices.filter((n) => !ownGroups.has(n.share_group_id));
  const multiCompany = ctx.companies.length > 1;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Muutostyöt</h1>
        {canSubmit ? <LinkButton href="/portaali/muutostyot/uusi">Tee muutostyöilmoitus</LinkButton> : null}
      </div>
      <p className="mt-2 text-sm text-ink/65">
        Osakkaan on ilmoitettava yhtiölle kirjallisesti etukäteen huoneistossa tehtävästä muutostyöstä, joka voi vaikuttaa rakenteisiin, eristyksiin, vesi-, lämpö-, kaasu-,
        sähkö- tai ilmanvaihtojärjestelmiin tai muuten yhtiön tai toisen osakkaan hallinnassa oleviin tiloihin.
      </p>
      {tila === "lahetetty" ? (
        <div className="mt-4" role="status">
          <Notice tone="ok" title="Ilmoitus lähetettiin isännöitsijälle.">
            Saat viestin, kun ilmoitus on käsitelty. Älä aloita työtä ennen kuin yhtiö on käsitellyt ilmoituksen.
          </Notice>
        </div>
      ) : null}

      <h2 className="mt-6 text-lg">Omat ilmoitukset</h2>
      <div className="mt-3 grid gap-3">
        {own.length === 0 ? (
          <EmptyState title="Ei muutostyöilmoituksia">{canSubmit ? "Tee ilmoitus ennen kuin aloitat remontin." : "Muutostyöilmoituksen voi tehdä huoneiston osakas."}</EmptyState>
        ) : (
          own.map((n) => <NoticeCard key={n.id} n={n} showCompany={multiCompany} />)
        )}
      </div>

      {others.length > 0 ? (
        <>
          <h2 className="mt-8 text-lg">Yhtiön muutostyöilmoitukset</h2>
          <p className="text-sm text-ink/60">Näet nämä hallituksen jäsenenä.</p>
          <div className="mt-3 grid gap-3">
            {others.map((n) => (
              <NoticeCard key={n.id} n={n} showCompany={multiCompany} />
            ))}
          </div>
        </>
      ) : null}

      <p className="mt-8 text-sm">
        <Link href="/portaali" className="text-sky">
          ← Etusivulle
        </Link>
      </p>
    </>
  );
}
