import { FormError } from "@/components/FormError";
import { Button, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listCompanies } from "@/lib/registry/queries";
import { documentYears, listDocuments } from "@/lib/documents/queries";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES } from "@/lib/documents/labels";
import { DocumentTable } from "./DocumentTable";
import { DocumentUploadForm } from "./DocumentUploadForm";

export const metadata = { title: "Dokumentit" };

type SP = { luokka?: string; yhtio?: string; vuosi?: string; haku?: string; liitteet?: string; virhe?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const category = sp.luokka && (DOCUMENT_CATEGORIES as readonly string[]).includes(sp.luokka) ? sp.luokka : null;
  const companyId = sp.yhtio && /^[0-9a-f-]{36}$/i.test(sp.yhtio) ? sp.yhtio : null;
  const year = sp.vuosi && /^\d{4}$/.test(sp.vuosi) ? Number(sp.vuosi) : null;
  const q = sp.haku?.trim().slice(0, 100) || null;
  const includeAttachments = sp.liitteet === "1";

  const [rows, companies, years] = await ctx.run((tx) =>
    Promise.all([
      listDocuments(tx, { organizationId: ctx.org.organizationId, companyId, category, year, q, includeAttachments }),
      listCompanies(tx, ctx.org.organizationId),
      documentYears(tx),
    ]),
  );
  const filtered = Boolean(category || companyId || year || q);
  const canUpload = ctx.can("owner", "manager", "assistant", "accountant");

  return (
    <>
      <PageHeader title="Dokumentit" subtitle="Kaikkien yhtiöiden dokumenttipankki" />
      <FormError message={sp.virhe} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
            <Input name="haku" defaultValue={q ?? ""} placeholder="Hae otsikosta" className="w-full sm:w-56" aria-label="Hae otsikosta" />
            <Select name="luokka" defaultValue={category ?? ""} className="sm:w-52" aria-label="Luokka">
              <option value="">Kaikki luokat</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
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
            <Select name="vuosi" defaultValue={year ? String(year) : ""} className="sm:w-52" aria-label="Vuosi">
              <option value="">Kaikki vuodet</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 px-2 text-sm">
              <input type="checkbox" name="liitteet" value="1" defaultChecked={includeAttachments} className="size-4" />
              Näytä liitteet
            </label>
            <Button variant="secondary">Suodata</Button>
          </form>
          {rows.length === 0 ? (
            <EmptyState title={filtered ? "Ei hakua vastaavia dokumentteja" : "Ei vielä dokumentteja"}>
              Tallenna yhtiöjärjestys, tilinpäätökset, energiatodistus ja pöytäkirjat, niin ne löytyvät yhdestä paikasta.
            </EmptyState>
          ) : (
            <DocumentTable rows={rows} />
          )}
        </div>
        {canUpload ? <DocumentUploadForm back="/dokumentit" companies={companies.map((c) => ({ id: c.id, name: c.name }))} /> : null}
      </div>
    </>
  );
}
