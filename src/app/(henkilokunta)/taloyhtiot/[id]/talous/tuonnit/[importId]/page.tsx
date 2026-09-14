import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { DefinitionList, EmptyState, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatReference } from "@/lib/validation/finnish";
import type { ImportRow } from "@/lib/finance/queries";

export const metadata = { title: "Maksutilanteen tuonti" };

/** Tuontiraportti: mitä kohdistui ja mitkä rivit jäivät kohdistamatta. */
export default async function PaymentImportPage({ params }: { params: Promise<{ id: string; importId: string }> }) {
  const ctx = await requireStaff();
  const { id, importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const company = await loadCompany(ctx, id);
  const [imp] = await ctx.run((tx) =>
    tx.query<ImportRow>(
      `select i.id, i.file_name, i.as_of::text, i.rows, i.matched, i.unmatched, i.created_at, coalesce(u.full_name, u.email) as imported_by_name
         from er_payment_imports i left join er_users u on u.id = i.imported_by
        where i.id = $1 and i.company_id = $2`,
      [importId, id],
    ),
  );
  if (!imp) notFound();

  return (
    <>
      <CompanyHeader company={company} active="talous" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Maksutilanne {formatDate(imp.as_of)}</h2>
        <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
          Takaisin talouteen
        </LinkButton>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        <Panel>
          <SectionTitle>Tuonti</SectionTitle>
          <DefinitionList
            items={[
              { label: "Tiedosto", value: imp.file_name },
              { label: "Tuotu", value: `${formatDateTime(imp.created_at)}, ${imp.imported_by_name ?? "–"}` },
              { label: "Rivejä", value: imp.rows },
              { label: "Kohdistettu osakeryhmiä", value: imp.matched },
              { label: "Kohdistamatta", value: imp.unmatched.length },
            ]}
          />
          <p className="mt-4 text-xs text-ink/55">Osakeryhmät, joita tiedostossa ei ollut, merkittiin tälle päivälle nollasaldolle.</p>
        </Panel>
        <div className="grid content-start gap-4">
          {imp.unmatched.length === 0 ? (
            <EmptyState title="Kaikki rivit kohdistuivat">Maksutilanne näkyy huoneistoittain talous-välilehdellä ja osakkaille portaalissa.</EmptyState>
          ) : (
            <>
              <Notice tone="alert" title={imp.unmatched.length === 1 ? "1 rivi jäi kohdistamatta" : `${imp.unmatched.length} riviä jäi kohdistamatta`}>
                Näitä saatavia ei näytetä huoneistoilla. Korjaa viite kirjanpidossa tai lisää huoneiston tunnus tiedostoon ja tuo uudelleen samalle päivälle.
              </Notice>
              <Table>
                <thead>
                  <tr>
                    <Th numeric>Rivi</Th>
                    <Th>Viite</Th>
                    <Th>Huoneisto</Th>
                    <Th numeric>Avoin €</Th>
                    <Th numeric>Erääntynyt €</Th>
                    <Th>Syy</Th>
                  </tr>
                </thead>
                <tbody>
                  {imp.unmatched.map((u) => (
                    <tr key={u.line}>
                      <Td numeric>{u.line}</Td>
                      <Td className="tabular whitespace-nowrap">{u.reference ? formatReference(u.reference) : "–"}</Td>
                      <Td>{u.unit_label ?? "–"}</Td>
                      <Td numeric>{u.open_eur}</Td>
                      <Td numeric>{u.overdue_eur}</Td>
                      <Td>{u.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </div>
      </div>
    </>
  );
}
