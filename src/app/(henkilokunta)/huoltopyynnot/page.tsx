import Link from "next/link";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listStaff } from "@/lib/registry/queries";
import { StatusBadge, UrgencyBadge } from "@/lib/service-requests/components/parts";
import { CATEGORY_LABEL, STATUSES, STATUS_LABEL, URGENCIES, URGENCY_LABEL, type RequestStatus, type Urgency } from "@/lib/service-requests/labels";
import { listCompanyOptions, listRequests } from "@/lib/service-requests/queries";

export const metadata = { title: "Huoltopyynnöt" };

type Search = { tila?: string; yhtio?: string; kiire?: string; vastuu?: string; kaikki?: string };

const isUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);

export default async function ServiceRequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.tila ?? "") ? (sp.tila as RequestStatus) : null;
  const urgency = (URGENCIES as readonly string[]).includes(sp.kiire ?? "") ? (sp.kiire as Urgency) : null;
  const companyId = isUuid(sp.yhtio) ? sp.yhtio! : null;
  const assigneeId = sp.vastuu === "oma" ? ctx.user.id : isUuid(sp.vastuu) ? sp.vastuu! : null;
  const unassigned = sp.vastuu === "ei";
  const openOnly = !status && sp.kaikki !== "1";

  const [rows, companies, staff] = await ctx.run((tx) =>
    Promise.all([
      listRequests(tx, ctx.org.organizationId, { status, urgency, companyId, assigneeId, unassigned, openOnly }),
      listCompanyOptions(tx, ctx.org.organizationId),
      listStaff(tx, ctx.org.organizationId),
    ]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <>
      <PageHeader
        title="Huoltopyynnöt"
        subtitle={`${rows.length} ${openOnly ? "avointa" : "pyyntöä"}${overdue ? `, ${overdue} myöhässä` : ""}`}
        actions={canWrite ? <LinkButton href="/huoltopyynnot/uusi">Uusi pyyntö</LinkButton> : null}
      />

      <form method="get" className="mb-5 grid gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="grid gap-1 text-sm font-semibold">
          Tila
          <Select name="tila" defaultValue={status ?? ""}>
            <option value="">Kaikki tilat</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Yhtiö
          <Select name="yhtio" defaultValue={companyId ?? ""}>
            <option value="">Kaikki yhtiöt</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Kiireellisyys
          <Select name="kiire" defaultValue={urgency ?? ""}>
            <option value="">Kaikki</option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {URGENCY_LABEL[u]}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Vastuuhenkilö
          <Select name="vastuu" defaultValue={sp.vastuu === "oma" || sp.vastuu === "ei" ? sp.vastuu : assigneeId ?? ""}>
            <option value="">Kaikki</option>
            <option value="oma">Minä</option>
            <option value="ei">Ei vastuuhenkilöä</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="kaikki" value="1" defaultChecked={sp.kaikki === "1"} className="h-5 w-5" />
          Näytä myös valmiit ja suljetut
        </label>
        <div className="flex items-end gap-2">
          <Button variant="secondary" type="submit">
            Suodata
          </Button>
          <Link href="/huoltopyynnot" className="px-2 pb-3 text-sm text-ink/60 hover:text-ink">
            Tyhjennä
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Ei pyyntöjä näillä ehdoilla" action={canWrite ? <LinkButton href="/huoltopyynnot/uusi">Uusi pyyntö</LinkButton> : null}>
          Portaalista ja yhtiöiden QR-lomakkeilta tulevat pyynnöt näkyvät tässä.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nro</Th>
              <Th>Pyyntö</Th>
              <Th>Yhtiö</Th>
              <Th>Tila</Th>
              <Th>Vastuu</Th>
              <Th>Määräaika</Th>
              <Th>Saapui</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-cloud/50">
                <Td className="tabular text-ink/60">#{r.number}</Td>
                <Td>
                  <Link href={`/huoltopyynnot/${r.id}`} className="font-semibold hover:text-sky">
                    {r.title}
                  </Link>
                  <p className="text-xs text-ink/55">{CATEGORY_LABEL[r.category]}</p>
                </Td>
                <Td>
                  {r.company_name}
                  {r.unit_label ? <span className="block text-xs text-ink/55">{r.unit_label}</span> : null}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={r.status} />
                    <UrgencyBadge urgency={r.urgency} />
                  </div>
                </Td>
                <Td>
                  {r.assignee_name ?? <span className="text-ink/50">–</span>}
                  {r.provider_name ? <span className="block text-xs text-ink/55">{r.provider_name}</span> : null}
                </Td>
                <Td>{r.due_on ? r.overdue ? <Badge tone="alert">{formatDate(r.due_on)}</Badge> : formatDate(r.due_on) : "–"}</Td>
                <Td className="whitespace-nowrap text-ink/65">{formatDate(r.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
