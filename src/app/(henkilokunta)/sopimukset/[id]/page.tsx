import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Notice, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { contractTiming } from "@/lib/contracts/deadlines";
import { CONTRACT_CATEGORY_LABEL, CONTRACT_STATUS_LABEL } from "@/lib/contracts/labels";
import { getContract, listContractDocuments } from "@/lib/contracts/queries";
import { formatDate, formatDateTime, formatEur, isoDateHelsinki } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { ContractForm } from "../ContractForm";
import { deleteContractAction } from "../actions";

export const metadata = { title: "Sopimus" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tallennettu?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tallennettu } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [contract, companies, documents] = await ctx.run((tx) =>
    Promise.all([getContract(tx, id), listCompanies(tx, ctx.org.organizationId), listContractDocuments(tx, ctx.org.organizationId)]),
  );
  if (!contract || contract.organization_id !== ctx.org.organizationId) notFound();
  const today = isoDateHelsinki();
  const t = contractTiming(contract, today);
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader
        title={contract.counterparty}
        subtitle={`${contract.company_name} · ${CONTRACT_CATEGORY_LABEL[contract.category]}`}
        back={{ href: "/sopimukset", label: "Sopimukset" }}
      />
      <FormError message={virhe} />
      {tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Sopimus tallennettu" />
        </div>
      ) : null}
      {t.endingSoon ? (
        <div className="mb-5">
          <Notice tone="warn" title={t.deadline && t.daysToDeadline !== null && t.daysToDeadline >= 0 ? `Irtisanottava viimeistään ${formatDate(t.deadline)} (${t.daysToDeadline} pv)` : `Päättyy ${formatDate(contract.ends_on)}`}>
            Päätä hallituksen kanssa, jatketaanko, kilpailutetaanko vai irtisanotaanko sopimus.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ContractForm contract={contract} companies={companies} documents={documents} readOnly={!canWrite} />
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Määräajat</SectionTitle>
            <DefinitionList
              items={[
                { label: "Tila", value: <Badge tone={t.effectiveStatus === "ended" ? "neutral" : t.endingSoon ? "warn" : "ok"}>{CONTRACT_STATUS_LABEL[t.effectiveStatus]}</Badge> },
                { label: "Päättyy", value: contract.ends_on ? formatDate(contract.ends_on) : "Toistaiseksi" },
                { label: "Irtisanomisen viimeinen päivä", value: t.deadline ? formatDate(t.deadline) : "–" },
                { label: "Muistutus", value: contract.reminder_on ? `${formatDate(contract.reminder_on)}${contract.reminded_at ? `, lähetetty ${formatDateTime(contract.reminded_at)}` : ""}` : "–" },
                { label: "Vuosikustannus", value: formatEur(contract.annual_cost_eur) },
                {
                  label: "Asiakirja",
                  value: contract.document_id ? <a href={`/api/dokumentit/${contract.document_id}`} className="text-sky">{contract.document_title ?? "Avaa"}</a> : "–",
                },
              ]}
            />
          </Panel>
          {canWrite ? (
            <form action={deleteContractAction}>
              <input type="hidden" name="id" value={contract.id} />
              <Button variant="ghost" className="text-coral">Poista sopimus</Button>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
