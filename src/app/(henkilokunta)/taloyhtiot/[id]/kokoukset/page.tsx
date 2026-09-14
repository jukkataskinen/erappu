import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, LinkButton, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { activeOrderLinks, readOrderLinkFlash } from "@/lib/certificates/order-link";
import { listOrders } from "@/lib/certificates/orders";
import { ORDER_STATUS, ORDER_STATUS_TONE } from "@/lib/certificates/pricing";
import { formatDate } from "@/lib/format";
import { listMeetings } from "@/lib/meetings/queries";
import { MeetingTable, NewMeetingForm } from "../../../kokoukset/components";
import { OrderLinkControls } from "../../../todistukset/OrderLinkPanel";

export const metadata = { title: "Kokoukset" };

export default async function CompanyMeetingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const [upcoming, past, orders, links] = await ctx.run((tx) =>
    Promise.all([
      listMeetings(tx, { companyId: id, scope: "upcoming" }),
      listMeetings(tx, { companyId: id, scope: "past", limit: 30 }),
      listOrders(tx, company.organization_id, { companyId: id, limit: 10 }),
      activeOrderLinks(tx, [id]),
    ]),
  );
  const flash = await readOrderLinkFlash();
  const canWrite = ctx.can("owner", "manager", "assistant");
  const back = `/taloyhtiot/${id}/kokoukset`;

  return (
    <>
      <CompanyHeader company={company} active="kokoukset" actions={<LinkButton variant="secondary" href="/todistukset">Todistukset</LinkButton>} />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          <section>
            <SectionTitle>Tulevat kokoukset</SectionTitle>
            <MeetingTable meetings={upcoming} empty="Ei tulevia kokouksia" />
          </section>
          <section>
            <SectionTitle>Pidetyt kokoukset</SectionTitle>
            <MeetingTable meetings={past} empty="Ei pidettyjä kokouksia" />
          </section>
        </div>
        <div className="grid content-start gap-6">
          {canWrite ? <NewMeetingForm companyId={id} /> : null}
          <Panel>
            <SectionTitle actions={<Link href="/todistukset" className="text-sm text-sky">Kaikki</Link>}>Isännöitsijäntodistukset</SectionTitle>
            {orders.length === 0 ? (
              <p className="mb-4 text-sm text-ink/65">Ei tilauksia.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-semibold">{o.unit_label}</span> · {formatDate(o.created_at)}
                      {o.express ? " · pika" : ""}
                    </span>
                    <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS[o.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-2 text-sm font-semibold">Julkinen tilauslomake</p>
            <OrderLinkControls
              companyId={id}
              back={back}
              active={links.has(id) ? { expiresAt: links.get(id) ?? null } : null}
              flashUrl={flash?.companyId === id ? flash.url : null}
              canWrite={canWrite}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
