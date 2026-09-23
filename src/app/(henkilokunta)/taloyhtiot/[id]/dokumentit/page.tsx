import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { EmptyState, Notice } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { companyMissingBasics, listDocuments } from "@/lib/documents/queries";
import { DocumentTable } from "../../../dokumentit/DocumentTable";
import { DocumentUploadForm } from "../../../dokumentit/DocumentUploadForm";

export const metadata = { title: "Dokumentit" };

export default async function CompanyDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; liitteet?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe, liitteet } = await searchParams;
  const includeAttachments = liitteet === "1";

  const [rows, missing, groups] = await ctx.run((tx) =>
    Promise.all([
      listDocuments(tx, { companyId: id, includeAttachments }),
      companyMissingBasics(tx, id),
      tx.query<{ id: string; unit_label: string }>(
        "select id, unit_label from er_share_groups where company_id = $1 and removed_on is null order by length(unit_label), unit_label",
        [id],
      ),
    ]),
  );
  const canUpload = ctx.can("owner", "manager", "assistant", "accountant");
  const back = `/taloyhtiot/${id}/dokumentit`;

  return (
    <>
      <CompanyHeader company={company} active="dokumentit" />
      <FormError message={virhe} />
      {missing.length > 0 ? (
        <div className="mb-5">
          <Notice tone="warn" title="Perusdokumenteista puuttuu">
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m.category}>{m.reason}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-4 text-sm">
            {/* Koko aineiston luovutus (palvelusopimus 10.3): rekisteri CSV:nä ja asiakirjat tiedostoina. */}
            {ctx.can("owner", "manager", "assistant") ? (
              <a href={`/taloyhtiot/${id}/aineisto`} className="text-sky" download>
                Lataa yhtiön aineisto (zip)
              </a>
            ) : null}
            <Link href={includeAttachments ? back : `${back}?liitteet=1`} className="text-sky">
              {includeAttachments ? "Piilota liitteet" : "Näytä liitteet"}
            </Link>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="Yhtiöllä ei ole vielä dokumentteja">Lisää yhtiöjärjestys, viimeisin tilinpäätös ja energiatodistus ensimmäisenä.</EmptyState>
          ) : (
            <DocumentTable rows={rows} showCompany={false} />
          )}
        </div>
        {canUpload ? <DocumentUploadForm back={back} fixedCompanyId={id} shareGroups={groups} /> : null}
      </div>
    </>
  );
}
