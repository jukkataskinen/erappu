import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Select, Table, Td, Th, Button } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { listAnnouncements } from "@/lib/announcements/queries";
import { ANNOUNCEMENT_STATUS, audienceText } from "@/lib/announcements/labels";

export const metadata = { title: "Tiedotteet" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ tila?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const status = sp.tila && sp.tila in ANNOUNCEMENT_STATUS ? sp.tila : null;
  const companyId = sp.yhtio && /^[0-9a-f-]{36}$/i.test(sp.yhtio) ? sp.yhtio : null;
  const [rows, companies] = await ctx.run((tx) =>
    Promise.all([listAnnouncements(tx, { organizationId: ctx.org.organizationId, status, companyId }), listCompanies(tx, ctx.org.organizationId)]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");
  const boardDrafts = rows.filter((r) => r.status === "draft" && r.origin === "board").length;

  return (
    <>
      <PageHeader
        title="Tiedotteet"
        subtitle={boardDrafts > 0 ? `${boardDrafts} hallituksen luonnosta odottaa julkaisua` : "Tiedotteet osakkaille, asukkaille ja hallitukselle"}
        actions={
          <>
            <LinkButton variant="secondary" href="/tiedotteet/lahetykset">
              Lähetykset
            </LinkButton>
            {canWrite ? <LinkButton href="/tiedotteet/uusi">Uusi tiedote</LinkButton> : null}
          </>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <Select name="tila" defaultValue={status ?? ""} className="sm:w-52" aria-label="Tila">
          <option value="">Kaikki tilat</option>
          {Object.entries(ANNOUNCEMENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select name="yhtio" defaultValue={companyId ?? ""} className="sm:w-52" aria-label="Taloyhtiö">
          <option value="">Kaikki yhtiöt</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary">Suodata</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Ei tiedotteita" action={canWrite ? <LinkButton href="/tiedotteet/uusi">Kirjoita tiedote</LinkButton> : null}>
          Tiedote näkyy portaalissa ja lähtee halutessasi sähköpostina yhtiön osakkaille, asukkaille tai hallitukselle.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tiedote</Th>
              <Th>Yhtiö</Th>
              <Th>Tila</Th>
              <Th>Julkaistu</Th>
              <Th numeric>Tavoitettu</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-cloud/50">
                <Td>
                  <Link href={`/tiedotteet/${r.id}`} className="font-semibold hover:text-sky">
                    {r.title}
                  </Link>
                  <p className="text-xs text-ink/55">{audienceText(r.audience_roles)}</p>
                </Td>
                <Td>{r.company_name}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={ANNOUNCEMENT_STATUS[r.status].tone}>{ANNOUNCEMENT_STATUS[r.status].label}</Badge>
                    {r.origin === "board" ? <Badge tone="info">Hallitus</Badge> : null}
                  </div>
                </Td>
                <Td>{formatDate(r.published_at)}</Td>
                <Td numeric>
                  {r.status === "draft" ? (
                    "–"
                  ) : (
                    <>
                      <span>{r.recipient_party_count ?? 0} hlö</span>
                      <span className="block text-xs text-ink/55">
                        {r.channels.includes("email") ? `${r.sent}/${r.email_recipient_count ?? 0} sähköpostia` : "vain portaali"}
                        {r.failed > 0 ? <span className="text-coral"> · {r.failed} epäonnistui</span> : null}
                        {` · ${r.reads} luki`}
                      </span>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
