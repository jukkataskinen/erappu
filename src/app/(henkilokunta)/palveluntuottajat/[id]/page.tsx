import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { StatusBadge } from "@/lib/service-requests/components/parts";
import { getProvider, listCompanyOptions, listCompanyServices, listRequests } from "@/lib/service-requests/queries";
import { addCompanyService, removeCompanyService, setDefaultService, updateProvider } from "../actions";
import { ProviderFields } from "../ProviderFields";

export const metadata = { title: "Palveluntuottaja" };

export default async function ProviderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe } = await searchParams;
  const provider = await ctx.run((tx) => getProvider(tx, id));
  if (!provider) notFound();
  const [services, companies, requests] = await ctx.run((tx) =>
    Promise.all([
      listCompanyServices(tx, { providerId: id }),
      listCompanyOptions(tx, ctx.org.organizationId),
      listRequests(tx, ctx.org.organizationId, { openOnly: true, providerId: id }),
    ]),
  );
  const open = requests;
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader back={{ href: "/palveluntuottajat", label: "Palveluntuottajat" }} title={provider.name} subtitle={provider.business_id ?? undefined} />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Yhtiökohtaiset palvelut</SectionTitle>
            {services.length === 0 ? (
              <EmptyState title="Ei liitetty yhtiöihin">Liitä palveluntuottaja yhtiöön. Oletus huoltopyynnöille liitetään uusiin pyyntöihin automaattisesti.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Yhtiö</Th>
                    <Th>Palvelu</Th>
                    <Th>Huoltopyynnöt</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <Link href={`/taloyhtiot/${s.company_id}/huolto`} className="font-semibold hover:text-sky">
                          {s.company_name}
                        </Link>
                      </Td>
                      <Td>{s.service}</Td>
                      <Td>
                        {s.default_for_requests ? <Badge tone="ok">Oletus</Badge> : null}
                        {canWrite ? (
                          <form action={setDefaultService} className="inline">
                            <input type="hidden" name="provider_id" value={id} />
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="default" value={s.default_for_requests ? "0" : "1"} />
                            <button className="ml-2 text-xs text-sky">{s.default_for_requests ? "Poista oletus" : "Aseta oletukseksi"}</button>
                          </form>
                        ) : null}
                      </Td>
                      <Td>
                        {canWrite ? (
                          <form action={removeCompanyService}>
                            <input type="hidden" name="provider_id" value={id} />
                            <input type="hidden" name="id" value={s.id} />
                            <button className="text-xs text-coral">Poista</button>
                          </form>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canWrite ? (
              <form action={addCompanyService} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="provider_id" value={id} />
                <Field label="Yhtiö" htmlFor="company_id">
                  <Select id="company_id" name="company_id" required defaultValue="">
                    <option value="" disabled>
                      Valitse
                    </option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Palvelu" htmlFor="service">
                  <Input id="service" name="service" required maxLength={100} defaultValue={provider.trades[0] ?? "kiinteistöhuolto"} />
                </Field>
                <Button variant="secondary" type="submit">
                  Liitä
                </Button>
                <label className="flex items-center gap-2 text-sm sm:col-span-3">
                  <input type="checkbox" name="default_for_requests" className="h-5 w-5" /> Oletus yhtiön huoltopyynnöille
                </label>
              </form>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Avoimet pyynnöt</SectionTitle>
            {open.length === 0 ? (
              <p className="text-sm text-ink/65">Ei avoimia pyyntöjä.</p>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/huoltopyynnot/${r.id}`} className="font-semibold hover:text-sky">
                      #{r.number} {r.title}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-ink/60">
                      {r.company_name} · {formatDate(r.created_at)} <StatusBadge status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {canWrite ? (
          <Panel>
            <SectionTitle>Tiedot</SectionTitle>
            <form action={updateProvider} className="grid gap-4">
              <input type="hidden" name="id" value={id} />
              <ProviderFields provider={provider} />
              <div>
                <Button type="submit">Tallenna</Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
