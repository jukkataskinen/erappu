import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listProviders } from "@/lib/service-requests/queries";
import { createProvider } from "./actions";
import { ProviderFields } from "./ProviderFields";

export const metadata = { title: "Palveluntuottajat" };

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { virhe } = await searchParams;
  const providers = await ctx.run((tx) => listProviders(tx, ctx.org.organizationId));
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader title="Palveluntuottajat" subtitle="Huoltoyhtiöt, urakoitsijat ja päivystys" />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div>
          {providers.length === 0 ? (
            <EmptyState title="Ei palveluntuottajia">Lisää kiinteistöhuolto ja muut urakoitsijat, jotta voit tilata töitä huoltopyynnöistä.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Nimi</Th>
                  <Th>Yhteystiedot</Th>
                  <Th>Toimialat</Th>
                  <Th numeric>Yhtiöt</Th>
                  <Th numeric>Avoimet</Th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="row-link hover:bg-cloud/50">
                    <Td>
                      <Link href={`/palveluntuottajat/${p.id}`} className="row-link-main font-semibold hover:text-sky">
                        {p.name}
                      </Link>
                      {p.business_id ? <p className="text-xs text-ink/55">{p.business_id}</p> : null}
                    </Td>
                    <Td>
                      {[p.email, p.phone].filter(Boolean).join(" · ") || "–"}
                      {p.emergency_phone ? <span className="block text-xs text-ink/60">Päivystys {p.emergency_phone}</span> : null}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {p.trades.length ? p.trades.map((t) => <Badge key={t}>{t}</Badge>) : "–"}
                      </div>
                    </Td>
                    <Td numeric>{p.company_count}</Td>
                    <Td numeric>{p.open_requests}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        {canWrite ? (
          <Panel>
            <SectionTitle>Lisää palveluntuottaja</SectionTitle>
            <form action={createProvider} className="grid gap-4">
              <ProviderFields />
              <div>
                <Button type="submit">Lisää</Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
