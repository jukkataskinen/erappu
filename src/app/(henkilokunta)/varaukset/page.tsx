import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listResources } from "@/lib/bookings/queries";
import { openHoursSummary } from "@/lib/bookings/slots";
import { formatEur } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { ResourceForm } from "./ResourceForm";

export const metadata = { title: "Varaukset" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ yhtio?: string; virhe?: string }> }) {
  const ctx = await requireStaff();
  const { yhtio, virhe } = await searchParams;
  const companyId = yhtio && /^[0-9a-f-]{36}$/i.test(yhtio) ? yhtio : null;
  const [companies, resources] = await ctx.run((tx) =>
    Promise.all([listCompanies(tx, ctx.org.organizationId), listResources(tx, { organizationId: ctx.org.organizationId, companyId })]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");
  const byCompany = new Map<string, typeof resources>();
  for (const r of resources) byCompany.set(r.company_name, [...(byCompany.get(r.company_name) ?? []), r]);

  return (
    <>
      <PageHeader title="Varaukset" subtitle="Saunat, pesutuvat ja kerhohuoneet. Osakkaat ja asukkaat varaavat vuorot portaalissa." />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-6">
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4">
            <div className="min-w-64 flex-1">
              <Field label="Yhtiö" htmlFor="f_yhtio">
                <Select id="f_yhtio" name="yhtio" defaultValue={companyId ?? ""}>
                  <option value="">Kaikki yhtiöt</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button variant="secondary">Näytä</Button>
          </form>

          {resources.length === 0 ? (
            <EmptyState title="Ei varauskohteita">Lisää yhtiön sauna tai pesutupa, niin osakkaat ja asukkaat voivat varata vuoroja portaalissa.</EmptyState>
          ) : (
            [...byCompany.entries()].map(([companyName, items]) => (
              <section key={companyName}>
                <h2 className="mb-2 text-lg">{companyName}</h2>
                <Table>
                  <thead>
                    <tr>
                      <Th>Kohde</Th>
                      <Th>Aukioloajat</Th>
                      <Th>Vuoro</Th>
                      <Th>Kiintiö</Th>
                      <Th numeric>Hinta</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id} className="hover:bg-cloud/50">
                        <Td>
                          <Link href={`/varaukset/${r.id}`} className="font-semibold hover:text-sky">{r.name}</Link>
                          <div className="mt-0.5 flex gap-1">
                            {r.active ? null : <Badge tone="neutral">Ei varattavissa</Badge>}
                            {r.allow_recurring ? <Badge tone="info">Vakiovuorot</Badge> : null}
                          </div>
                        </Td>
                        <Td className="text-xs text-ink/70">{openHoursSummary(r.open_hours)}</Td>
                        <Td>{r.slot_minutes} min</Td>
                        <Td>{r.max_active_bookings_per_unit ? `${r.max_active_bookings_per_unit} / huoneisto` : "–"}</Td>
                        <Td numeric>{formatEur(r.price_eur)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            ))
          )}
        </div>

        {canWrite ? (
          <Panel>
            <SectionTitle>Lisää varauskohde</SectionTitle>
            <ResourceForm companies={companies} defaultCompanyId={companyId ?? undefined} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
