import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Notice, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { MESSAGE_STATUS, maskEmail } from "@/lib/announcements/labels";
import { dispatchQueueNow, requeueFailed } from "../actions";

export const metadata = { title: "Lähetykset" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ virhe?: string; lahetetty?: string; epaonnistui?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const status = sp.tila && sp.tila in MESSAGE_STATUS ? sp.tila : null;
  const orgId = ctx.org.organizationId;

  const { counts, rows } = await ctx.run(async (tx) => {
    const [counts] = await tx.query<{ queued: number; sent: number; failed: number; oldest_queued: string | null }>(
      `select count(*) filter (where status = 'queued')::int as queued,
              count(*) filter (where status in ('sent', 'delivered') and sent_at > now() - interval '30 days')::int as sent,
              count(*) filter (where status = 'failed')::int as failed,
              min(created_at) filter (where status = 'queued') as oldest_queued
         from er_outbound_messages where organization_id = $1`,
      [orgId],
    );
    const rows = await tx.query<{
      id: string; channel: string; recipient: string; subject: string; status: string; error: string | null; created_at: string; sent_at: string | null;
      subject_table: string | null; subject_id: string | null;
    }>(
      `select id, channel, recipient, subject, status, error, created_at, sent_at, subject_table, subject_id
         from er_outbound_messages
        where organization_id = $1 and ($2::text is null or status = $2)
        order by case status when 'failed' then 0 when 'queued' then 1 else 2 end, created_at desc
        limit 200`,
      [orgId, status],
    );
    return { counts, rows };
  });
  const canDispatch = ctx.can("owner", "manager");

  return (
    <>
      <PageHeader
        back={{ href: "/tiedotteet", label: "Tiedotteet" }}
        title="Lähetykset"
        subtitle="Lähtevien viestien jono. Ajastettu lähetys purkaa jonon automaattisesti."
        actions={
          canDispatch ? (
            <>
              {counts.failed > 0 ? (
                <form action={requeueFailed}>
                  <Button variant="secondary">Palauta epäonnistuneet jonoon</Button>
                </form>
              ) : null}
              <form action={dispatchQueueNow}>
                <Button disabled={counts.queued === 0}>Lähetä jono nyt</Button>
              </form>
            </>
          ) : null
        }
      />
      <FormError message={sp.virhe} />
      {sp.lahetetty !== undefined ? (
        <div className="mb-5">
          <Notice tone={Number(sp.epaonnistui) > 0 ? "warn" : "ok"} title="Jono käsitelty">
            Lähetetty {Number(sp.lahetetty) || 0}, epäonnistui {Number(sp.epaonnistui) || 0}.
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Jonossa" value={counts.queued} tone={counts.queued ? "warn" : undefined} href="/tiedotteet/lahetykset?tila=queued" />
        <Stat label="Lähetetty (30 pv)" value={counts.sent} tone="ok" href="/tiedotteet/lahetykset?tila=sent" />
        <Stat label="Epäonnistunut" value={counts.failed} tone={counts.failed ? "alert" : undefined} href="/tiedotteet/lahetykset?tila=failed" />
      </div>
      {counts.oldest_queued ? <p className="mb-4 text-sm text-ink/60">Vanhin jonossa oleva viesti: {formatDateTime(counts.oldest_queued)}</p> : null}

      {rows.length === 0 ? (
        <EmptyState title="Ei viestejä">Tiedotteiden ja ilmoitusten sähköpostit näkyvät tässä.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Aihe</Th>
              <Th>Vastaanottaja</Th>
              <Th>Tila</Th>
              <Th>Luotu</Th>
              <Th>Lähetetty</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td>
                  {m.subject_table === "er_announcements" && m.subject_id ? (
                    <Link href={`/tiedotteet/${m.subject_id}`} className="font-semibold hover:text-sky">
                      {m.subject}
                    </Link>
                  ) : (
                    <span className="font-semibold">{m.subject}</span>
                  )}
                  {m.error ? <p className="text-xs text-coral">{m.error}</p> : null}
                </Td>
                <Td>{m.channel === "email" ? maskEmail(m.recipient) : m.channel}</Td>
                <Td>
                  <Badge tone={MESSAGE_STATUS[m.status]?.tone ?? "neutral"}>{MESSAGE_STATUS[m.status]?.label ?? m.status}</Badge>
                </Td>
                <Td>{formatDateTime(m.created_at)}</Td>
                <Td>{formatDateTime(m.sent_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
