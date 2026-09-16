import Link from "next/link";
import { Badge, EmptyState, PageHeader, Select, Table, Td, Th, Button } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE, CONTACT_TOPIC_LABEL } from "@/lib/contacts/labels";
import { listStaffThreads, type StaffThreadFilter } from "@/lib/contacts/queries";
import { formatDateTime } from "@/lib/format";
import { listCompanyOptions } from "@/lib/service-requests/queries";

export const metadata = { title: "Yhteydenotot" };

const FILTERS: { value: StaffThreadFilter; label: string }[] = [
  { value: "active", label: "Avoimet ja vastatut" },
  { value: "open", label: "Odottaa vastausta" },
  { value: "answered", label: "Vastattu" },
  { value: "closed", label: "Käsitellyt" },
  { value: "all", label: "Kaikki" },
];

export default async function StaffContactsPage({ searchParams }: { searchParams: Promise<{ tila?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const status = FILTERS.find((f) => f.value === sp.tila)?.value ?? "active";
  const companyId = sp.yhtio && /^[0-9a-f-]{36}$/i.test(sp.yhtio) ? sp.yhtio : undefined;
  const [rows, companies] = await ctx.run((tx) => Promise.all([listStaffThreads(tx, ctx.org.organizationId, { status, companyId }), listCompanyOptions(tx, ctx.org.organizationId)]));
  const waiting = rows.filter((r) => r.status === "open").length;

  return (
    <>
      <PageHeader
        title="Yhteydenotot"
        subtitle={`Osakkaiden ja asukkaiden viestit portaalista${waiting ? ` · ${waiting} odottaa vastausta` : ""}`}
      />

      <form method="get" className="mb-5 grid gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Tila
          <Select name="tila" defaultValue={status}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Taloyhtiö
          <Select name="yhtio" defaultValue={companyId ?? ""}>
            <option value="">Kaikki yhtiöt</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-end">
          <Button type="submit" variant="secondary">
            Näytä
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Ei yhteydenottoja">Portaalin käyttäjät voivat lähettää isännöinnille viestejä kohdasta Yhteydenotot.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Otsikko</Th>
              <Th>Kohde</Th>
              <Th>Kysyjä</Th>
              <Th>Viimeisin viesti</Th>
              <Th>Tila</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link href={`/yhteydenotot/${t.id}`} className="font-semibold hover:text-sky">
                    {t.subject}
                  </Link>
                  <span className="block text-xs text-ink/55">
                    {CONTACT_TOPIC_LABEL[t.topic]} · {t.message_count === 1 ? "1 viesti" : `${t.message_count} viestiä`}
                    {t.attachment_count ? ` · ${t.attachment_count} liitettä` : ""}
                  </span>
                </Td>
                <Td>
                  {t.company_name}
                  {t.unit_label ? <span className="block text-xs text-ink/55">huoneisto {t.unit_label}</span> : null}
                </Td>
                <Td>{t.creator_name ?? "–"}</Td>
                <Td>
                  <span className="tabular text-sm">{formatDateTime(t.last_message_at)}</span>
                </Td>
                <Td>
                  <Badge tone={CONTACT_STATUS_TONE[t.status]}>{CONTACT_STATUS_LABEL[t.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
